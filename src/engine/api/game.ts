// Public engine API. Every function is pure: inputs are never modified, and
// illegal input comes back as an error value instead of an exception.

import { validateCatalog } from '../model/cards';
import { other, SLOTS } from '../model/types';
import type {
  Action,
  CardCatalog,
  CardId,
  EngineError,
  GameEvent,
  GameSetup,
  GameState,
  PlayerId,
  PlayerState,
  Task,
} from '../model/types';
import { canonicalJson, deepClone } from '../core/clone';
import { hashSeed, nextInt, seedRng, shuffle } from '../core/rng';
import { log, stageSlot } from '../core/zones';
import { validateDeck } from '../rules/deck';
import { perform, run } from '../rules/flow';
import { canPlayFromHand } from '../rules/play';

export type CreateResult = { ok: true; state: GameState } | { ok: false; errors: (EngineError & { player?: PlayerId })[] };
export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: EngineError };
export type ValidateResult = { ok: true } | { ok: false; error: EngineError };

export const OPENING_HAND = 5;

function emptyPlayer(): PlayerState {
  return {
    deck: [],
    hand: [],
    waiting: [],
    clock: [],
    level: [],
    stock: [],
    memory: [],
    resolution: [],
    stage: SLOTS.map(() => []),
    climax: [],
    mulliganDone: false,
  };
}

export function instanceId(player: PlayerId, n: number): CardId {
  return `p${player}-${String(n).padStart(2, '0')}`;
}

/** A blank state with no cards; used by createGame and the test kit. */
export function blankState(seed: string): GameState {
  return {
    schema: 1,
    rulesVersion: '2.10',
    seed,
    rng: seedRng(seed),
    cards: {},
    players: [emptyPlayer(), emptyPlayer()],
    starting: 0,
    active: 0,
    turn: 0,
    phase: 'setup',
    tasks: [],
    pending: null,
    result: null,
    flags: { endCheckResolved: false },
    seq: 0,
    log: [],
  };
}

/**
 * Starts a game (CR 5.2): checks both decks, shuffles them, picks the starting
 * player at random with no choice for anyone, deals opening hands and stops at
 * the starting player's mulligan decision.
 */
export function createGame(setup: GameSetup, catalog: CardCatalog): CreateResult {
  const decks = (setup as { decks?: unknown }).decks;
  if (!Array.isArray(decks) || decks.length !== 2) {
    return { ok: false, errors: [{ code: 'TWO_PLAYERS', message: 'a game has exactly two players, so exactly two decks' }] };
  }
  const catalogErrors = validateCatalog(catalog);
  if (catalogErrors.length > 0) return { ok: false, errors: catalogErrors };
  const errors = ([0, 1] as const).flatMap((player) => validateDeck(setup.decks[player], catalog).map((e) => ({ ...e, player })));
  if (errors.length > 0) return { ok: false, errors };

  const s = blankState(setup.seed);
  for (const player of [0, 1] as const) {
    setup.decks[player].forEach((def, n) => {
      const id = instanceId(player, n);
      s.cards[id] = { id, def, owner: player, epoch: 0 };
      s.players[player].deck.push(id);
    });
    const [shuffled, rng] = shuffle(s.rng, s.players[player].deck);
    s.players[player].deck = shuffled;
    s.rng = rng;
    log(s, { kind: 'shuffle', player });
  }
  const [coin, rng] = nextInt(s.rng, 2);
  s.rng = rng;
  s.starting = coin as PlayerId;
  s.active = s.starting;
  log(s, { kind: 'setup', starting: s.starting });

  const first = s.starting;
  const second = other(first);
  const draws = (player: PlayerId): Task[] => Array.from({ length: OPENING_HAND }, () => ({ t: 'draw', player }));
  s.tasks = [...draws(first), ...draws(second), { t: 'mulligan', player: first }, { t: 'mulligan', player: second }, { t: 'startTurn' }];
  run(s, catalog);
  return { ok: true, state: s };
}

/** The player the game is waiting on, or null when it is over. */
export function actor(state: GameState): PlayerId | null {
  return state.pending?.player ?? null;
}

/** Canonical key for an action. MULLIGAN and DISCARD card lists are sets, so their order does not matter. */
export function actionKey(action: Action): string {
  if (action.type === 'MULLIGAN') return canonicalJson({ ...action, discard: [...action.discard].sort() });
  if (action.type === 'DISCARD') return canonicalJson({ ...action, cards: [...action.cards].sort() });
  return canonicalJson(action);
}

function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[]];
  for (const item of items) {
    const n = out.length;
    for (let i = 0; i < n; i++) out.push([...(out[i] as T[]), item]);
  }
  return out;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * Every legal action for the player the game is waiting on, sorted by
 * actionKey. Excludes CONCEDE and REORDER, which are always available to their
 * player through applyAction but are not game moves.
 */
export function legalActions(state: GameState, catalog: CardCatalog, player?: PlayerId): Action[] {
  const pending = state.pending;
  if (!pending || state.result) return [];
  const p = pending.player;
  if (player !== undefined && player !== p) return [];
  const ps = state.players[p];
  const actions: Action[] = [];

  switch (pending.kind) {
    case 'mulligan':
      for (const discard of subsets(ps.hand)) actions.push({ type: 'MULLIGAN', player: p, discard });
      break;
    case 'clock':
      actions.push({ type: 'CLOCK', player: p, card: null });
      for (const card of ps.hand) actions.push({ type: 'CLOCK', player: p, card });
      break;
    case 'play':
      actions.push({ type: 'PASS', player: p });
      for (const card of ps.hand) {
        if (!canPlayFromHand(state, catalog, p, card, pending.window)) continue;
        const kind = catalog[state.cards[card]?.def ?? '']?.kind;
        if (kind === 'character') for (const slot of SLOTS) actions.push({ type: 'PLAY_CHARACTER', player: p, card, slot });
        else if (kind === 'event') actions.push({ type: 'PLAY_EVENT', player: p, card });
        else if (kind === 'climax') actions.push({ type: 'PLAY_CLIMAX', player: p, card });
      }
      if (pending.window === 'main') {
        for (const a of SLOTS) {
          for (const b of SLOTS) {
            // Swapping two empty positions does nothing (CR 6.5.1.2.4), so it is not offered.
            if (a < b && (stageSlot(ps, a).length > 0 || stageSlot(ps, b).length > 0)) actions.push({ type: 'SWAP', player: p, a, b });
          }
        }
      }
      break;
    case 'levelUp':
      for (const card of pending.options) actions.push({ type: 'LEVEL_UP', player: p, card });
      break;
    case 'interruptOrder':
      for (const interrupt of pending.options) actions.push({ type: 'CHOOSE_INTERRUPT', player: p, interrupt });
      break;
    case 'discard':
      for (const cards of combinations(ps.hand, pending.count)) actions.push({ type: 'DISCARD', player: p, cards });
      break;
  }
  return actions.map((a) => [actionKey(a), a] as const).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, a]) => a);
}

function isPlayer(x: unknown): x is PlayerId {
  return x === 0 || x === 1;
}

export function validate(state: GameState, catalog: CardCatalog, action: Action): ValidateResult {
  const fail = (code: string, message: string): ValidateResult => ({ ok: false, error: { code, message } });
  if (state.result) return fail('GAME_OVER', 'the game is over');
  if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
    return fail('BAD_ACTION', 'not an action');
  }
  if (!isPlayer(action.player)) return fail('BAD_PLAYER', 'player must be 0 or 1');
  if (action.type === 'CONCEDE') return { ok: true };
  if (action.type === 'REORDER') {
    const zone = action.zone as string;
    if (zone !== 'hand' && zone !== 'waiting') return fail('NOT_REORDERABLE', `players may not reorder the ${zone}`);
    const current = state.players[action.player][action.zone];
    const same = Array.isArray(action.order) && action.order.length === current.length && [...action.order].sort().join() === [...current].sort().join();
    if (!same) return fail('BAD_REORDER', 'the new order must contain exactly the cards already there');
    return { ok: true };
  }
  const pending = state.pending;
  if (!pending || pending.player !== action.player) return fail('NOT_YOUR_DECISION', `player ${action.player} has no decision to make`);
  const key = actionKey(action);
  if (!legalActions(state, catalog).some((a) => actionKey(a) === key)) {
    return fail('ILLEGAL_ACTION', `${action.type} is not legal now (waiting on ${pending.kind})`);
  }
  return { ok: true };
}

/**
 * Copies a state for modification. Logged events are never changed after they
 * are written, so the log array is copied but its events are shared.
 */
export function cloneState(state: GameState): GameState {
  const { log: events, ...rest } = state;
  return { ...deepClone(rest), log: events.slice() };
}

/** Validates and applies one action, then runs the game to its next decision. */
export function applyAction(state: GameState, catalog: CardCatalog, action: Action): ApplyResult {
  const v = validate(state, catalog, action);
  if (!v.ok) return v;
  const s = cloneState(state);
  const before = s.log.length;
  perform(s, catalog, deepClone(action));
  run(s, catalog);
  return { ok: true, state: s, events: s.log.slice(before) };
}

export type ReplayResult = { ok: true; state: GameState } | { ok: false; index: number; error: EngineError };

/** Rebuilds a game from its setup and the actions taken. The same inputs always give the same state. */
export function replay(setup: GameSetup, catalog: CardCatalog, actions: readonly Action[]): ReplayResult {
  const created = createGame(setup, catalog);
  if (!created.ok) return { ok: false, index: -1, error: created.errors[0] ?? { code: 'SETUP', message: 'setup failed' } };
  let state = created.state;
  for (let i = 0; i < actions.length; i++) {
    const r = applyAction(state, catalog, actions[i] as Action);
    if (!r.ok) return { ok: false, index: i, error: r.error };
    state = r.state;
  }
  return { ok: true, state };
}

/** Stable hash of the whole state (128-bit cyrb128 over canonical JSON). */
export function stateHash(state: GameState): string {
  return hashSeed(canonicalJson(state))
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}
