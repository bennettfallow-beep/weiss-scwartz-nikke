// Saved games and replays. A save is the game's setup and its actions, so it
// rebuilds the exact game; it holds the seed, so it must stay on the device
// and is never shown. A replay is the same after the game is over, for
// sharing. Loading never trusts the file: every field is checked, and any
// problem comes back as a code, never a crash.

import { normalizeAction, RULES_SOURCE, seedRng, stateHash } from '../engine';
import type { Action, GameResult, LossReason } from '../engine';
import { canonicalJson } from './canonical';
import { advance, startRecord } from './record';
import { seedProblem } from './session';
import type { CardSource, GameRecord, Mode, Seat, Session } from './types';

export const SAVE_FORMAT = 'frontline-duel/save';
export const REPLAY_FORMAT = 'frontline-duel/replay';
export const SAVE_VERSION = 1;
export const MAX_SAVE_CHARS = 2_000_000;
/** Real games stay far below this (the simulator stops a game at 5,000 actions). */
const MAX_ACTIONS = 6_000;
const MAX_DECK = 60;
const MAX_NAME = 40;
const MAX_KEY = 64;

export const SAVE_ERROR_CODES = [
  'SAVE_NOT_JSON',
  'SAVE_TOO_LARGE',
  'SAVE_NOT_OBJECT',
  'SAVE_FORMAT',
  'SAVE_VERSION_NEWER',
  'SAVE_VERSION_UNKNOWN',
  'SAVE_FIELD',
  'SAVE_RULES',
  'SAVE_CATALOG',
  'SAVE_SETUP',
  'SAVE_ACTION',
  'SAVE_REPLAY',
  'SAVE_SEED',
  'SAVE_HASH_CHANGED',
  'GAME_NOT_OVER',
] as const;
export type SaveErrorCode = (typeof SAVE_ERROR_CODES)[number];

export interface SaveError {
  readonly code: SaveErrorCode;
  readonly message: string;
  readonly path?: string;
  /** For SAVE_REPLAY: the action that failed. */
  readonly index?: number;
}

export interface SaveV1 {
  readonly format: typeof SAVE_FORMAT;
  readonly version: 1;
  readonly rules: string;
  /** Fingerprint of the card catalog the game was played with. */
  readonly catalog: string;
  readonly mode: Mode;
  readonly seats: readonly [Seat, Seat];
  readonly setup: { readonly seed: string; readonly decks: readonly [readonly string[], readonly string[]] };
  readonly actions: readonly Action[];
  /** stateHash of the game when saved. A different hash on load means the engine changed. */
  readonly hash: string;
}

export interface ReplayV1 extends Omit<SaveV1, 'format'> {
  readonly format: typeof REPLAY_FORMAT;
  readonly result: GameResult;
}

type Fail = { ok: false; error: SaveError };

function fail(code: SaveErrorCode, message: string, path?: string): Fail {
  return { ok: false, error: path === undefined ? { code, message } : { code, message, path } };
}

const HEX32 = /^[0-9a-f]{32}$/;

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** The save for a session, at any point of the game. */
export function toSave(s: Session): SaveV1 {
  const setup = s.game.setup;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    rules: RULES_SOURCE.version,
    catalog: s.cards.fingerprint,
    mode: s.mode,
    seats: [{ ...s.seats[0] }, { ...s.seats[1] }],
    setup: { seed: setup.seed, decks: [[...setup.decks[0]], [...setup.decks[1]]] },
    actions: s.game.actions.map((a) => ({ ...a })),
    hash: stateHash(s.game.state),
  };
}

/** Reads save text. Size is checked before parsing. */
export function parseSave(text: unknown): { ok: true; raw: unknown } | Fail {
  if (typeof text !== 'string') return fail('SAVE_NOT_JSON', 'a save is text');
  if (text.length > MAX_SAVE_CHARS) return fail('SAVE_TOO_LARGE', `a save is at most ${MAX_SAVE_CHARS} characters`);
  try {
    return { ok: true, raw: JSON.parse(text) as unknown };
  } catch {
    return fail('SAVE_NOT_JSON', 'the save is not valid JSON');
  }
}

/** Upgrades an older save object to the next version. Keyed by the version it upgrades from. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export interface NormalizeOptions {
  /** Extra upgrades (tests), merged over the built-in chain. */
  readonly migrations?: Readonly<Record<number, Migration>>;
  /** 'save' (default) or 'replay'. */
  readonly kind?: 'save' | 'replay';
}

function seatOf(raw: unknown, i: number): Seat | null {
  if (!isObject(raw)) return null;
  const kind = raw.kind;
  const deck = raw.deck;
  if (kind !== 'human' && kind !== 'computer') return null;
  if (typeof deck !== 'string' || deck.length === 0 || deck.length > MAX_KEY) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME).trim() : '';
  return { name: name.length > 0 ? name : kind === 'computer' ? 'Computer' : `Player ${i + 1}`, kind, deck };
}

function deckOf(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DECK) return null;
  return raw.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_KEY) ? [...(raw as string[])] : null;
}

const LOSS_REASONS: readonly LossReason[] = ['level4', 'deckOut', 'concede'];
function isLossReason(x: unknown): x is LossReason {
  return LOSS_REASONS.some((r) => r === x);
}

function resultOf(raw: unknown): GameResult | null {
  if (!isObject(raw)) return null;
  if (raw.kind === 'win') {
    const { winner, loser, reason } = raw;
    if ((winner === 0 || winner === 1) && (loser === 0 || loser === 1) && winner !== loser && isLossReason(reason)) return { kind: 'win', winner, loser, reason };
    return null;
  }
  const reasons: unknown = raw.reasons;
  if (raw.kind === 'draw' && Array.isArray(reasons) && reasons.length === 2) {
    const [a, b] = reasons as unknown[];
    if (isLossReason(a) && isLossReason(b)) return { kind: 'draw', reasons: [a, b] };
  }
  return null;
}

/**
 * Checks and cleans a parsed save (or replay): unknown fields are dropped,
 * names trimmed, actions rebuilt by the engine's own checker. The result of a
 * second call on its own output is identical (`changed: false`).
 */
export function normalizeSave(
  raw: unknown,
  options: NormalizeOptions = {},
): { ok: true; save: SaveV1 | ReplayV1; changed: boolean } | Fail {
  const kind = options.kind ?? 'save';
  if (!isObject(raw)) return fail('SAVE_NOT_OBJECT', 'a save is a JSON object');
  const format = kind === 'save' ? SAVE_FORMAT : REPLAY_FORMAT;
  if (raw.format !== format) return fail('SAVE_FORMAT', `not a ${kind} of this app`, 'format');
  let r: Record<string, unknown> = raw;
  const first = r.version;
  if (typeof first !== 'number' || !Number.isInteger(first)) return fail('SAVE_VERSION_UNKNOWN', 'the save has no version', 'version');
  let version: number = first;
  if (version > SAVE_VERSION) return fail('SAVE_VERSION_NEWER', 'this save comes from a newer version of the app', 'version');
  const chain = { ...MIGRATIONS, ...(options.migrations ?? {}) };
  while (version < SAVE_VERSION) {
    const step = chain[version];
    if (!step) return fail('SAVE_VERSION_UNKNOWN', `no upgrade from save version ${version}`, 'version');
    r = step(r);
    const next = r.version;
    if (typeof next !== 'number' || next <= version) return fail('SAVE_VERSION_UNKNOWN', 'a save upgrade did not advance the version', 'version');
    version = next;
  }
  // Never turn an untrusted value into text with String(): deeply nested data would overflow the stack.
  if (r.rules !== RULES_SOURCE.version) return fail('SAVE_RULES', `the save was made with rules version ${typeof r.rules === 'string' ? r.rules.slice(0, 40) : 'unknown'}`, 'rules');
  if (typeof r.catalog !== 'string' || !HEX32.test(r.catalog)) return fail('SAVE_FIELD', 'the card set fingerprint is missing', 'catalog');
  if (r.mode !== 'hotseat' && r.mode !== 'computer') return fail('SAVE_FIELD', 'unknown game mode', 'mode');
  const mode: Mode = r.mode;
  if (!Array.isArray(r.seats) || r.seats.length !== 2) return fail('SAVE_FIELD', 'a save has two seats', 'seats');
  const s0 = seatOf(r.seats[0], 0);
  const s1 = seatOf(r.seats[1], 1);
  if (!s0 || !s1) return fail('SAVE_FIELD', 'a seat is malformed', `seats.${s0 ? 1 : 0}`);
  const computers = [s0, s1].filter((x) => x.kind === 'computer').length;
  if ((mode === 'computer' && computers !== 1) || (mode === 'hotseat' && computers !== 0)) return fail('SAVE_FIELD', 'the seats do not match the mode', 'seats');
  const setup = r.setup;
  if (!isObject(setup)) return fail('SAVE_SETUP', 'the setup is missing', 'setup');
  if (seedProblem(setup.seed)) return fail('SAVE_SETUP', 'the seed is malformed', 'setup.seed');
  const decks = setup.decks;
  const d0 = Array.isArray(decks) && decks.length === 2 ? deckOf(decks[0]) : null;
  const d1 = Array.isArray(decks) && decks.length === 2 ? deckOf(decks[1]) : null;
  if (!d0 || !d1) return fail('SAVE_SETUP', 'the decks are malformed', 'setup.decks');
  if (!Array.isArray(r.actions) || r.actions.length > MAX_ACTIONS) return fail('SAVE_FIELD', 'the actions are malformed', 'actions');
  const actions: Action[] = [];
  for (const [i, a] of r.actions.entries()) {
    const n = normalizeAction(a);
    if (!n.ok) return fail('SAVE_ACTION', `action ${i}: ${n.error.message}`, `actions.${i}`);
    actions.push(n.action);
  }
  if (typeof r.hash !== 'string' || !HEX32.test(r.hash)) return fail('SAVE_FIELD', 'the game hash is missing', 'hash');
  const body = {
    version: SAVE_VERSION as 1,
    rules: RULES_SOURCE.version,
    catalog: r.catalog,
    mode,
    seats: [s0, s1] as [Seat, Seat],
    setup: { seed: setup.seed as string, decks: [d0, d1] as [string[], string[]] },
    actions,
    hash: r.hash,
  };
  let save: SaveV1 | ReplayV1;
  if (kind === 'save') save = { format: SAVE_FORMAT, ...body };
  else {
    const result = resultOf(r.result);
    if (!result) return fail('SAVE_FIELD', 'the replay has no result', 'result');
    save = { format: REPLAY_FORMAT, ...body, result };
  }
  return { ok: true, save, changed: differs(save, raw) };
}

/**
 * True when the cleaned save differs from what was read. Unknown fields are
 * never walked into, so deeply nested junk in a file cannot overflow the stack;
 * any unknown field already counts as a change.
 */
function differs(save: SaveV1 | ReplayV1, raw: Record<string, unknown>): boolean {
  const known = new Set(Object.keys(save));
  if (Object.keys(raw).some((k) => !known.has(k))) return true;
  try {
    const picked = Object.fromEntries(Object.keys(save).map((k) => [k, raw[k]]));
    return canonicalJson(save) !== canonicalJson(picked);
  } catch {
    return true;
  }
}

export interface LoadOptions {
  /** Fresh entropy for the computer player (computer mode). */
  readonly botSeed?: string;
}

/** Rebuilds a game record from setup and actions, learning what each player saw on the way. */
function rebuild(save: SaveV1 | ReplayV1, cards: CardSource): { ok: true; record: GameRecord } | Fail {
  const started = startRecord({ seed: save.setup.seed, decks: [save.setup.decks[0], save.setup.decks[1]] }, cards.catalog);
  if (!started.ok) return fail('SAVE_SETUP', started.error.message, 'setup');
  let record = started.record;
  for (const [i, a] of save.actions.entries()) {
    const r = advance(record, cards.catalog, a);
    if (!r.ok) return { ok: false, error: { code: 'SAVE_REPLAY', message: `action ${i} cannot be played: ${r.error.message}`, path: `actions.${i}`, index: i } };
    record = r.record;
  }
  return { ok: true, record };
}

/**
 * Continues a saved game. The card source is picked by fingerprint, so a save
 * is only ever replayed with the cards it was made with. A changed game hash
 * (the engine changed since) is a warning: the game still loads.
 */
export function loadSave(
  save: SaveV1,
  sources: readonly CardSource[],
  options: LoadOptions = {},
): { ok: true; session: Session; warnings: SaveError[] } | Fail {
  const cards = sources.find((c) => c.fingerprint === save.catalog);
  if (!cards) return fail('SAVE_CATALOG', 'the cards this game was played with are not available', 'catalog');
  const botSeed = options.botSeed;
  if (save.mode === 'computer') {
    if (botSeed === undefined || seedProblem(botSeed)) return fail('SAVE_SEED', 'the computer player needs a fresh seed');
    if (botSeed === save.setup.seed) return fail('SAVE_SEED', 'the computer player must not share the game seed');
  }
  const built = rebuild(save, cards);
  if (!built.ok) return built;
  const warnings: SaveError[] = stateHash(built.record.state) === save.hash ? [] : [{ code: 'SAVE_HASH_CHANGED', message: 'the game engine changed since this game was saved' }];
  return {
    ok: true,
    session: {
      mode: save.mode,
      seats: save.seats,
      cards,
      game: built.record,
      holder: save.mode === 'computer' ? (save.seats[1].kind === 'human' ? 1 : 0) : null,
      botRng: save.mode === 'computer' && botSeed !== undefined ? seedRng(botSeed) : null,
    },
    warnings,
  };
}

/** The finished game as a replay file, or GAME_NOT_OVER while it is still being played. */
export function exportReplay(s: Session): { ok: true; replay: ReplayV1 } | Fail {
  const result = s.game.state.result;
  if (result === null) return fail('GAME_NOT_OVER', 'a replay can be made once the game is over');
  const save = toSave(s);
  return { ok: true, replay: { ...save, format: REPLAY_FORMAT, result } };
}

/** Plays a replay again and checks it ends in the same game. */
export function checkReplay(replay: ReplayV1, sources: readonly CardSource[]): { ok: true } | Fail {
  const cards = sources.find((c) => c.fingerprint === replay.catalog);
  if (!cards) return fail('SAVE_CATALOG', 'the cards this game was played with are not available', 'catalog');
  const built = rebuild(replay, cards);
  if (!built.ok) return built;
  const result = built.record.state.result;
  if (result === null) return fail('SAVE_REPLAY', 'the replayed game is not over', 'result');
  if (canonicalJson(result) !== canonicalJson(replay.result)) return fail('SAVE_REPLAY', 'the replay does not end with the recorded result', 'result');
  if (stateHash(built.record.state) !== replay.hash) return fail('SAVE_REPLAY', 'the replay does not end in the recorded game', 'hash');
  return { ok: true };
}
