// One game as a record of its setup and actions, plus what each player has
// seen. Each step keeps the previous record while the step can be undone.

import { actor, applyAction, createGame } from '../engine';
import type { Action, CardCatalog, EventKind, GameEvent, GameSetup, GameState, PlayerId } from '../engine';
import { learn } from './memory';
import type { GameRecord, SessionError } from './types';

export type RecordResult = { ok: true; record: GameRecord } | { ok: false; error: SessionError };

export function startRecord(setup: GameSetup, catalog: CardCatalog): RecordResult {
  const created = createGame(setup, catalog);
  if (!created.ok) {
    const first = created.errors[0];
    return { ok: false, error: { code: 'SETUP', message: first ? `${first.code}: ${first.message}` : 'the game could not be set up' } };
  }
  const state = created.state;
  const memory = [learn({}, state, state.log, 0), learn({}, state, state.log, 1)] as const;
  return { ok: true, record: { setup, actions: [], state, memory, marks: [state.log.length, state.log.length], prev: null } };
}

/** Events after which an undo could give a player information they should not have had. */
const REVEALING: ReadonlySet<EventKind> = new Set<EventKind>([
  'shuffle',
  'refresh',
  'look',
  'deckArranged',
  'triggerCheck',
  'damage',
  'damageTaken',
  'damageCanceled',
  'turnStart',
  'gameOver',
]);

/**
 * True when taking `action` back reveals nothing and changes nobody's
 * decision: the same player still acts, no random number was drawn, and no
 * card left a deck or stock (or the other player's hand), so the player has
 * learned nothing they could use after undoing.
 */
export function isReversible(before: GameState, after: GameState, events: readonly GameEvent[], action: Action): boolean {
  if (action.type === 'CONCEDE' || action.type === 'MULLIGAN' || after.result !== null) return false;
  if (actor(after) !== action.player) return false;
  const [r0, r1] = [before.rng, after.rng];
  if (r0.a !== r1.a || r0.b !== r1.b || r0.c !== r1.c || r0.d !== r1.d) return false;
  for (const e of events) {
    if (REVEALING.has(e.kind)) return false;
    if (e.kind === 'move') {
      if (e.from.zone === 'deck' || e.from.zone === 'stock') return false;
      if (e.from.zone === 'hand' && e.from.player !== action.player) return false;
    }
  }
  return true;
}

export function advance(record: GameRecord, catalog: CardCatalog, action: Action): RecordResult {
  const r = applyAction(record.state, catalog, action);
  if (!r.ok) return { ok: false, error: { code: 'ENGINE', message: `${r.error.code}: ${r.error.message}` } };
  const memory = [learn(record.memory[0], r.state, r.events, 0), learn(record.memory[1], r.state, r.events, 1)] as const;
  const marks: [number, number] = [record.marks[0], record.marks[1]];
  marks[action.player] = r.state.log.length;
  return {
    ok: true,
    record: {
      setup: record.setup,
      actions: [...record.actions, action],
      state: r.state,
      memory,
      marks,
      prev: isReversible(record.state, r.state, r.events, action) ? record : null,
    },
  };
}

/** The player whose decision the game is waiting for, or null when it is over. */
export function waitingFor(record: GameRecord): PlayerId | null {
  return record.state.result === null ? actor(record.state) : null;
}
