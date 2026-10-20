// Running a game for the app: starting it, applying a player's choice,
// handing the phone over in hot-seat play, the computer's moves, conceding
// and undo. Every function returns a new Session; none of them throws.

import { decide, heuristicBot } from '../ai';
import { actionKey, legalActions, other, seedRng } from '../engine';
import type { Action, PlayerId } from '../engine';
import { advance, startRecord, waitingFor } from './record';
import type { CardSource, GameRecord, Mode, Seat, Session, SessionError, SessionErrorCode, SessionResult } from './types';

export interface NewGameOptions {
  readonly mode: Mode;
  /** Deck keys from the card source, for player 0 and player 1. */
  readonly decks: readonly [string, string];
  /** Fresh entropy from the app; decides every shuffle. Never shown to players. */
  readonly seed: string;
  /** Separate fresh entropy for the computer player (computer mode only). */
  readonly botSeed?: string;
  /** The human's seat against the computer. Default 0. */
  readonly humanSeat?: PlayerId;
}

const MAX_SEED = 200;

function fail(code: SessionErrorCode, message: string): { ok: false; error: SessionError } {
  return { ok: false, error: { code, message } };
}

/** True when `seed` is not a usable seed: text of 1 to 200 characters. */
export function seedProblem(seed: unknown): boolean {
  return typeof seed !== 'string' || seed.length === 0 || seed.length > MAX_SEED;
}

export function newGame(cards: CardSource, options: NewGameOptions): SessionResult {
  if (seedProblem(options.seed)) return fail('BAD_SEED', 'the game needs a seed of 1 to 200 characters');
  const [d0, d1] = options.decks;
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(cards.decks, key) ? cards.decks[key] : undefined);
  const deck0 = own(d0);
  const deck1 = own(d1);
  if (!deck0 || !deck1) return fail('BAD_DECK', `unknown deck: ${deck0 ? d1 : d0}`);
  let seats: readonly [Seat, Seat];
  let holder: PlayerId | null = null;
  let botRng = null;
  if (options.mode === 'computer') {
    if (options.botSeed === undefined || seedProblem(options.botSeed)) return fail('BOT_SEED_REQUIRED', 'the computer player needs its own seed');
    if (options.botSeed === options.seed) return fail('SAME_SEED', 'the computer player must not share the game seed');
    const human = options.humanSeat ?? 0;
    const seat = (p: PlayerId): Seat => (p === human ? { name: 'You', kind: 'human', deck: options.decks[p] } : { name: 'Computer', kind: 'computer', deck: options.decks[p] });
    seats = [seat(0), seat(1)];
    holder = human;
    botRng = seedRng(options.botSeed);
  } else {
    seats = [
      { name: 'Player 1', kind: 'human', deck: d0 },
      { name: 'Player 2', kind: 'human', deck: d1 },
    ];
  }
  const started = startRecord({ seed: options.seed, decks: [deck0, deck1] }, cards.catalog);
  if (!started.ok) return started;
  return { ok: true, session: { mode: options.mode, seats, cards, game: started.record, holder, botRng } };
}

/** The player whose decision the game is waiting for, or null when it is over. */
export function toAct(s: Session): PlayerId | null {
  return waitingFor(s.game);
}

/**
 * Hot-seat: the player now holding the phone, if it is their decision (or the
 * game is over); null while the phone must be handed over. Against the
 * computer: always the human.
 */
export function viewer(s: Session): PlayerId | null {
  if (s.mode === 'computer') return s.holder;
  const next = toAct(s);
  if (next === null) return s.holder;
  return s.holder === next ? next : null;
}

/** Hot-seat only: the player the phone must be handed to before anything is shown, or null. */
export function needsHandoff(s: Session): PlayerId | null {
  if (s.mode !== 'hotseat') return null;
  const next = toAct(s);
  return next !== null && next !== s.holder ? next : null;
}

/** The player has taken the phone: their board may now be shown. */
export function acceptHandoff(s: Session): Session {
  const to = needsHandoff(s);
  return to === null ? s : { ...s, holder: to };
}

/** Hides the board (the app went to the background): hot-seat needs a handoff before it shows again. */
export function cover(s: Session): Session {
  return s.mode === 'hotseat' && s.holder !== null ? { ...s, holder: null } : s;
}

/** The human seat against the computer, or null in hot-seat. */
export function humanSeat(s: Session): PlayerId | null {
  return s.mode === 'computer' ? s.holder : null;
}

function legalFor(s: Session, player: PlayerId): Action[] {
  return legalActions(s.game.state, s.cards.catalog, player);
}

function withGame(s: Session, game: GameRecord): Session {
  return { ...s, game };
}

/** Applies the legal action with this key for the player holding the phone. */
export function choose(s: Session, key: string): SessionResult {
  if (s.game.state.result !== null) return fail('GAME_OVER', 'the game is over');
  if (needsHandoff(s) !== null) return fail('HANDOFF_PENDING', 'hand the phone over first');
  const p = toAct(s);
  if (p === null || p !== viewer(s)) return fail('NOT_YOUR_DECISION', 'it is not your decision');
  const action = legalFor(s, p).find((a) => actionKey(a) === key);
  if (!action) return fail('UNKNOWN_CHOICE', 'that choice is not available now');
  const r = advance(s.game, s.cards.catalog, action);
  return r.ok ? { ok: true, session: withGame(s, r.record) } : r;
}

/** The player holding the phone concedes. */
export function concede(s: Session): SessionResult {
  if (s.game.state.result !== null) return fail('GAME_OVER', 'the game is over');
  const p = viewer(s);
  if (p === null) return fail('HANDOFF_PENDING', 'hand the phone over first');
  const r = advance(s.game, s.cards.catalog, { type: 'CONCEDE', player: p });
  return r.ok ? { ok: true, session: withGame(s, r.record) } : r;
}

/** True when the player holding the phone may take back their last step. */
export function canUndo(s: Session): boolean {
  const p = viewer(s);
  return s.game.prev !== null && p !== null && p === toAct(s) && s.seats[p].kind === 'human' && needsHandoff(s) === null;
}

export function undo(s: Session): SessionResult {
  if (!canUndo(s) || s.game.prev === null) return fail('NO_UNDO', 'the last step cannot be taken back');
  return { ok: true, session: withGame(s, s.game.prev) };
}

/** True when the computer player must decide now. */
export function botToMove(s: Session): boolean {
  const p = toAct(s);
  return s.mode === 'computer' && p !== null && s.seats[p].kind === 'computer' && s.botRng !== null;
}

/** The computer player makes exactly one decision. The app decides when, so moves can be paced. */
export function stepBot(s: Session): SessionResult {
  const p = toAct(s);
  if (!botToMove(s) || p === null || s.botRng === null) return fail('NO_BOT_TURN', 'it is not the computer player’s decision');
  let decision;
  try {
    decision = decide(s.game.state, s.cards.catalog, p, heuristicBot, s.botRng);
  } catch (e) {
    return fail('ENGINE', e instanceof Error ? e.message : 'the computer player failed');
  }
  const r = advance(s.game, s.cards.catalog, decision.action);
  return r.ok ? { ok: true, session: { ...s, game: r.record, botRng: decision.rng } } : r;
}

/** The other seat's name, as the player holding the phone sees it. */
export function opponentOf(s: Session, p: PlayerId): Seat {
  return s.seats[other(p)];
}
