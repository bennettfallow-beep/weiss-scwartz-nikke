// App state: which screen is open and the current game session. Pure (no
// React Native), so it is unit-tested in node. Every game change goes through
// the session layer; this file never looks inside a session.

import { acceptHandoff, botToMove, choose, concede, cover, newGame, stepBot, undo } from '../../session';
import type { CardSource, Mode, NewGameOptions, Session, SessionResult } from '../../session';

export type Route = { readonly name: 'home' } | { readonly name: 'newGame'; readonly mode: Mode } | { readonly name: 'game' } | { readonly name: 'help'; readonly back: 'home' | 'game' };

export type Overlay =
  | null
  | { readonly kind: 'log' }
  | { readonly kind: 'card'; readonly defId: string }
  | { readonly kind: 'zone'; readonly side: 'you' | 'opponent'; readonly zone: 'waiting' | 'clock' | 'level' | 'memory' }
  | { readonly kind: 'menu' }
  | { readonly kind: 'concede' };

export interface AppState {
  readonly cards: CardSource;
  readonly route: Route;
  readonly session: Session | null;
  /** The last game's setup, for a rematch. */
  readonly last: { readonly mode: Mode; readonly decks: readonly [string, string] } | null;
  readonly overlay: Overlay;
  /** The card whose choices the tray shows, as "zone:index" from the prompt. */
  readonly selected: string | null;
  /** Mulligan: card ids marked to put back. */
  readonly mulligan: readonly string[];
  /** A short message, e.g. when a choice is no longer available. */
  readonly notice: string | null;
}

export type AppAction =
  | { readonly type: 'navigate'; readonly route: Route }
  | { readonly type: 'start'; readonly options: NewGameOptions }
  | { readonly type: 'choose'; readonly key: string }
  | { readonly type: 'select'; readonly id: string | null }
  | { readonly type: 'toggleMulligan'; readonly card: string }
  | { readonly type: 'botStep' }
  | { readonly type: 'handoffDone' }
  | { readonly type: 'background' }
  | { readonly type: 'undo' }
  | { readonly type: 'concede' }
  | { readonly type: 'overlay'; readonly overlay: Overlay }
  | { readonly type: 'quit' }
  | { readonly type: 'notify'; readonly text: string }
  | { readonly type: 'dismissNotice' };

export function initialState(cards: CardSource): AppState {
  return { cards, route: { name: 'home' }, session: null, last: null, overlay: null, selected: null, mulligan: [], notice: null };
}

/** After any change of decision or holder: nothing selected, nothing open that could show a hand. */
function fresh(state: AppState, session: Session, keepOverlay = false): AppState {
  return { ...state, session, selected: null, mulligan: [], overlay: keepOverlay ? state.overlay : null, notice: null };
}

function applied(state: AppState, r: SessionResult, keepOverlay = false): AppState {
  if (r.ok) return fresh(state, r.session, keepOverlay);
  return { ...state, notice: r.error.code === 'UNKNOWN_CHOICE' ? 'That choice is no longer available.' : r.error.message, selected: null };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'navigate':
      return { ...state, route: action.route, overlay: null, notice: null };
    case 'start': {
      const r = newGame(state.cards, action.options);
      if (!r.ok) return { ...state, notice: r.error.message };
      return { ...fresh(state, r.session), route: { name: 'game' }, last: { mode: action.options.mode, decks: action.options.decks } };
    }
    case 'choose':
      return state.session ? applied(state, choose(state.session, action.key)) : state;
    case 'select':
      return { ...state, selected: action.id, notice: null };
    case 'toggleMulligan': {
      const has = state.mulligan.includes(action.card);
      return { ...state, mulligan: has ? state.mulligan.filter((c) => c !== action.card) : [...state.mulligan, action.card] };
    }
    case 'botStep':
      // Only when it really is the computer's turn: a stale timer does nothing.
      return state.session && botToMove(state.session) ? applied(state, stepBot(state.session), true) : state;
    case 'handoffDone':
      return state.session ? fresh(state, acceptHandoff(state.session)) : state;
    case 'background':
      // The app left the screen: in hot-seat the next look needs a handoff, and nothing stays open.
      return state.session ? fresh(state, cover(state.session)) : { ...state, overlay: null };
    case 'undo':
      return state.session ? applied(state, undo(state.session)) : state;
    case 'concede':
      return state.session ? applied(state, concede(state.session)) : state;
    case 'overlay':
      return { ...state, overlay: action.overlay };
    case 'quit':
      return { ...state, session: null, route: { name: 'home' }, overlay: null, selected: null, mulligan: [], notice: null };
    case 'notify':
      return { ...state, notice: action.text };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}
