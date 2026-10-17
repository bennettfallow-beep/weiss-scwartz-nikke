// Public engine API. Every function is pure: inputs are never modified, and
// illegal input comes back as an error value instead of an exception.

import { lookupDef, validateCatalog } from '../model/cards';
import { ATTACK_TYPES, other, SLOTS, TRIGGER_ICONS } from '../model/types';
import type {
  Action,
  CardCatalog,
  Slot,
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
import { attackOptions, canBackup } from '../rules/combat';
import { perform, run } from '../rules/flow';
import { activatable, canAccept } from '../rules/frame';
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
    step: null,
    attacks: 0,
    attack: null,
    triggerCheck: null,
    damage: null,
    effects: [],
    watchers: [],
    standby: [],
    moved: [],
    resolving: null,
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
  const raw = (typeof setup === 'object' && setup !== null ? setup : {}) as { decks?: unknown; seed?: unknown };
  if (typeof raw.seed !== 'string') return { ok: false, errors: [{ code: 'BAD_SEED', message: 'seed must be a string' }] };
  const decks = raw.decks;
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
    // Shuffle from a canonical order so the decklist order cannot steer the result (CR 3.2.4).
    const canonical = [...s.players[player].deck].sort((a, b) => {
      const da = s.cards[a]?.def ?? '';
      const db = s.cards[b]?.def ?? '';
      return da < db ? -1 : da > db ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    const [shuffled, rng] = shuffle(s.rng, canonical);
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
        const kind = lookupDef(catalog, state.cards[card]?.def ?? '')?.kind;
        if (kind === 'character') for (const slot of SLOTS) actions.push({ type: 'PLAY_CHARACTER', player: p, card, slot });
        else if (kind === 'event') actions.push({ type: 'PLAY_EVENT', player: p, card });
        else if (kind === 'climax') actions.push({ type: 'PLAY_CLIMAX', player: p, card });
      }
      if (pending.window === 'counter') {
        for (const card of ps.hand) if (canBackup(state, catalog, p, card)) actions.push({ type: 'BACKUP', player: p, card });
      }
      for (const a of activatable(state, catalog, p, pending.window)) actions.push({ type: 'ACTIVATE', player: p, card: a.card, ability: a.ability });
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
    case 'attack':
      actions.push({ type: 'PASS', player: p });
      for (const o of attackOptions(state, catalog)) actions.push({ type: 'ATTACK', player: p, slot: o.slot, attack: o.attack });
      break;
    case 'iconOrder':
      for (const icon of pending.icons) actions.push({ type: 'ORDER_ICON', player: p, icon });
      break;
    case 'choose':
      if (pending.optional) actions.push({ type: 'PASS', player: p });
      for (const card of pending.options) actions.push({ type: 'CHOOSE_CARD', player: p, card });
      break;
    case 'chooseSlot':
      for (const slot of pending.options) actions.push({ type: 'CHOOSE_SLOT', player: p, slot });
      break;
    case 'chooseDest':
      for (const dest of pending.options) actions.push({ type: 'CHOOSE_DEST', player: p, dest });
      break;
    case 'confirm':
    case 'encore':
      actions.push({ type: 'ACCEPT', player: p }, { type: 'PASS', player: p });
      break;
    case 'autoOrder':
      for (const a of pending.options) actions.push({ type: 'ORDER_AUTO', player: p, auto: a.id });
      break;
    case 'pick':
      if (pending.picked.length >= pending.min) actions.push({ type: 'PASS', player: p });
      for (const card of pending.options) actions.push({ type: 'CHOOSE_CARD', player: p, card });
      break;
    case 'optional':
      if (canAccept(state, catalog)) actions.push({ type: 'ACCEPT', player: p });
      actions.push({ type: 'PASS', player: p });
      break;
  }
  return actions.map((a) => [actionKey(a), a] as const).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, a]) => a);
}

function isPlayer(x: unknown): x is PlayerId {
  return x === 0 || x === 1;
}
const isString = (x: unknown): x is string => typeof x === 'string';
const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isString);
const isSlot = (x: unknown): x is Slot => x === 1 || x === 2 || x === 3 || x === 4 || x === 5;

type Checked = { ok: true; action: Action } | { ok: false; error: EngineError };
const bad = (code: string, message: string): { ok: false; error: EngineError } => ({ ok: false, error: { code, message } });

/**
 * Rebuilds an action from untrusted input, keeping only the fields its type
 * defines and checking their types. Anything malformed is an error value.
 */
export function normalizeAction(raw: unknown): Checked {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('BAD_ACTION', 'not an action');
  const r = raw as Record<string, unknown>;
  const player = r.player;
  if (!isPlayer(player)) return bad('BAD_PLAYER', 'player must be 0 or 1');
  const card = (): Checked | string => (isString(r.card) ? r.card : bad('BAD_ACTION', `${String(r.type)} needs a card id`));
  switch (r.type) {
    case 'PASS':
    case 'CONCEDE':
    case 'ACCEPT':
      return { ok: true, action: { type: r.type, player } };
    case 'MULLIGAN':
      return isStringArray(r.discard) ? { ok: true, action: { type: 'MULLIGAN', player, discard: [...r.discard] } } : bad('BAD_ACTION', 'discard must be a list of card ids');
    case 'DISCARD':
      return isStringArray(r.cards) ? { ok: true, action: { type: 'DISCARD', player, cards: [...r.cards] } } : bad('BAD_ACTION', 'cards must be a list of card ids');
    case 'CLOCK':
      return r.card === null || isString(r.card) ? { ok: true, action: { type: 'CLOCK', player, card: r.card } } : bad('BAD_ACTION', 'card must be a card id or null');
    case 'PLAY_CHARACTER': {
      const c = card();
      if (!isString(c)) return c;
      return isSlot(r.slot) ? { ok: true, action: { type: 'PLAY_CHARACTER', player, card: c, slot: r.slot } } : bad('BAD_SLOT', 'slot must be 1-5');
    }
    case 'PLAY_EVENT':
    case 'PLAY_CLIMAX':
    case 'LEVEL_UP':
    case 'BACKUP':
    case 'CHOOSE_CARD': {
      const c = card();
      return isString(c) ? { ok: true, action: { type: r.type, player, card: c } } : c;
    }
    case 'SWAP':
      return isSlot(r.a) && isSlot(r.b) ? { ok: true, action: { type: 'SWAP', player, a: r.a, b: r.b } } : bad('BAD_SLOT', 'a and b must be slots 1-5');
    case 'ATTACK':
      if (!isSlot(r.slot)) return bad('BAD_SLOT', 'slot must be 1-5');
      return ATTACK_TYPES.includes(r.attack as never)
        ? { ok: true, action: { type: 'ATTACK', player, slot: r.slot, attack: r.attack as (typeof ATTACK_TYPES)[number] } }
        : bad('BAD_ACTION', 'attack must be direct, frontal or side');
    case 'ORDER_ICON':
      return TRIGGER_ICONS.includes(r.icon as never)
        ? { ok: true, action: { type: 'ORDER_ICON', player, icon: r.icon as (typeof TRIGGER_ICONS)[number] } }
        : bad('BAD_ACTION', 'icon must be a trigger icon');
    case 'CHOOSE_SLOT':
      return isSlot(r.slot) ? { ok: true, action: { type: 'CHOOSE_SLOT', player, slot: r.slot } } : bad('BAD_SLOT', 'slot must be 1-5');
    case 'CHOOSE_DEST':
      return r.dest === 'hand' || r.dest === 'stock' ? { ok: true, action: { type: 'CHOOSE_DEST', player, dest: r.dest } } : bad('BAD_ACTION', 'dest must be hand or stock');
    case 'ORDER_AUTO':
      return Number.isSafeInteger(r.auto) ? { ok: true, action: { type: 'ORDER_AUTO', player, auto: r.auto as number } } : bad('BAD_ACTION', 'auto must be an ability id');
    case 'ACTIVATE': {
      const c = card();
      if (!isString(c)) return c;
      return Number.isSafeInteger(r.ability) && (r.ability as number) >= 0
        ? { ok: true, action: { type: 'ACTIVATE', player, card: c, ability: r.ability as number } }
        : bad('BAD_ACTION', 'ability must be a whole number >= 0');
    }
    case 'CHOOSE_INTERRUPT':
      return r.interrupt === 'refresh' || r.interrupt === 'levelUp'
        ? { ok: true, action: { type: 'CHOOSE_INTERRUPT', player, interrupt: r.interrupt } }
        : bad('BAD_ACTION', 'interrupt must be refresh or levelUp');
    case 'REORDER':
      if (r.zone !== 'hand' && r.zone !== 'waiting') return bad('NOT_REORDERABLE', `players may not reorder the ${String(r.zone)}`);
      return isStringArray(r.order) ? { ok: true, action: { type: 'REORDER', player, zone: r.zone, order: [...r.order] } } : bad('BAD_REORDER', 'order must be a list of card ids');
    default:
      return bad('BAD_ACTION', `unknown action type ${String(r.type)}`);
  }
}

/** True if `ids` are distinct and every one is in `pool`. */
function distinctFrom(ids: readonly string[], pool: readonly string[]): boolean {
  const set = new Set(ids);
  return set.size === ids.length && ids.every((id) => pool.includes(id));
}

function check(state: GameState, catalog: CardCatalog, raw: unknown): Checked {
  if (state.result) return bad('GAME_OVER', 'the game is over');
  const n = normalizeAction(raw);
  if (!n.ok) return n;
  const action = n.action;
  if (action.type === 'CONCEDE') return n;
  if (action.type === 'REORDER') {
    // CR 3.3.2 / 3.4.2: the same cards, only in a new order.
    const current = state.players[action.player][action.zone];
    const ok = action.order.length === current.length && distinctFrom(action.order, current);
    return ok ? n : bad('BAD_REORDER', 'the new order must contain exactly the cards already there');
  }
  const pending = state.pending;
  if (!pending || pending.player !== action.player) return bad('NOT_YOUR_DECISION', `player ${action.player} has no decision to make`);
  const hand = state.players[action.player].hand;
  // Set-valued choices are checked by structure, not by listing every subset.
  if (action.type === 'MULLIGAN') {
    return pending.kind === 'mulligan' && distinctFrom(action.discard, hand) ? n : bad('ILLEGAL_ACTION', 'a mulligan discards distinct cards from your hand');
  }
  if (action.type === 'DISCARD') {
    return pending.kind === 'discard' && action.cards.length === pending.count && distinctFrom(action.cards, hand)
      ? n
      : bad('ILLEGAL_ACTION', `discard exactly ${pending.kind === 'discard' ? pending.count : 0} distinct cards from your hand`);
  }
  const key = actionKey(action);
  if (!legalActions(state, catalog).some((a) => actionKey(a) === key)) {
    return bad('ILLEGAL_ACTION', `${action.type} is not legal now (waiting on ${pending.kind})`);
  }
  return n;
}

/** Checks an action without applying it. Accepts untrusted input; never throws on bad input. */
export function validate(state: GameState, catalog: CardCatalog, action: Action): ValidateResult {
  const c = check(state, catalog, action);
  return c.ok ? { ok: true } : c;
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
  const c = check(state, catalog, action);
  if (!c.ok) return c;
  const s = cloneState(state);
  const before = s.log.length;
  perform(s, catalog, c.action);
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
