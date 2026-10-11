// Rule tests for M1: playing cards from hand (CR 8.6.2) and rule actions
// (CR 9.1-9.6): interrupt and check types, refresh, level up, the losing
// verdict, insufficient power and illegal cards. Every title starts with the
// rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, legalActions, other, shuffle, validate } from '../../src/engine';
import type { Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId } from '../../src/engine';
import { act, cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const extra: CardDef[] = [
  { id: 'R2Z', name: 'Crimson Warden', kind: 'character', color: 'red', level: 2, cost: 0, power: 6000, soul: 1 },
  { id: 'RE0', name: 'Crimson Whisper', kind: 'event', color: 'red', level: 0, cost: 0 },
  { id: 'RE1', name: 'Crimson Spark', kind: 'event', color: 'red', level: 1, cost: 0 },
  { id: 'RE2', name: 'Crimson Flare', kind: 'event', color: 'red', level: 2, cost: 0 },
  { id: 'YK2', name: 'Amber Porter', kind: 'character', color: 'yellow', level: 0, cost: 2, power: 3000, soul: 1 },
  { id: 'YK3', name: 'Amber Hauler', kind: 'character', color: 'yellow', level: 0, cost: 3, power: 4000, soul: 1 },
  { id: 'YEV2', name: 'Amber Beacon', kind: 'event', color: 'yellow', level: 0, cost: 2 },
  { id: 'P1', name: 'Faint Ember', kind: 'character', color: 'green', level: 0, cost: 0, power: 1, soul: 1 },
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** A plain deck so nobody decks out by accident. */
const FILL = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];
/** Seven clock cards with seven different definitions, bottom -> top. */
const SEVEN = ['Y0', 'Y0b', 'Y1', 'Y2', 'R0', 'R1', 'B0'];
const SIX = SEVEN.slice(0, 6);

type MoveEvent = Extract<GameEvent, { kind: 'move' }>;

function eventsOf<K extends GameEvent['kind']>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}
const movesOf = (events: readonly GameEvent[]): MoveEvent[] => eventsOf(events, 'move');
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const defOfId = (s: GameState, id: CardId | undefined): string | undefined => (id === undefined ? undefined : s.cards[id]?.def);
const sorted = <T extends string | undefined>(xs: readonly T[]): T[] => [...xs].sort();

function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i}`);
  return x;
}

/** Player 0 is the turn player; the engine runs to the main-phase play timing (or the first decision before it). */
function main(p0: ZoneSpec, p1: ZoneSpec = { deck: FILL }, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { players: [{ deck: FILL, ...p0 }, p1], start: 'main', ...more });
}

/** Same, but starting at the climax phase (the climax play timing). */
function climaxPhase(p0: ZoneSpec, p1: ZoneSpec = { deck: FILL }): GameState {
  return makeState(cat, { players: [{ deck: FILL, ...p0 }, p1], start: 'climax' });
}

/** Whether the first card with this definition in the player's hand can be played right now. */
function canPlay(s: GameState, def: string, player: PlayerId = 0): boolean {
  const card = cardIn(s, player, 'hand', def);
  return legalActions(s, cat).some((a) => a.type.startsWith('PLAY_') && 'card' in a && a.card === card);
}

/** The error code applyAction gives, or 'ok'. Accepts deliberately malformed actions. */
function attempt(s: GameState, action: unknown): string {
  const r = applyAction(s, cat, action as Action);
  return r.ok ? 'ok' : r.error.code;
}

/** Definitions on each stage position (index i is position i + 1). */
function stageDefs(s: GameState, player: PlayerId): (string | undefined)[][] {
  return s.players[player].stage.map((cards) => cards.map((c) => defOfId(s, c.id)));
}
const climaxDefs = (s: GameState, player: PlayerId): (string | undefined)[] => s.players[player].climax.map((c) => defOfId(s, c.id));

/** The milestones that order a resolution. */
function marks(events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'move') {
      if (e.to.zone === 'level') return ['level'];
      if (e.reason === 'draw' || e.reason === 'cost' || e.reason === 'refreshClock' || e.reason === 'clock') return [e.reason];
      return [];
    }
    if (e.kind === 'refresh') return [`refresh:${e.player}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}`];
    if (e.kind === 'played') return ['played'];
    if (e.kind === 'gameOver') return ['gameOver'];
    return [];
  });
}

/** How one played card travels: cost payments, the "played" moment, and the card's own moves. */
function playTrace(events: readonly GameEvent[], card: CardId): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'move' && e.reason === 'cost') return ['cost'];
    if (e.kind === 'played' && e.card === card) return ['played'];
    if (e.kind === 'move' && e.card === card) return [`${e.reason}->${e.to.zone}`];
    return [];
  });
}

/** Gives the last `n` entries of a stage position or climax area the same (newest) placement stamp. */
function tieNewest(entries: { placedAt: number }[] | undefined, n: number): void {
  if (!entries || entries.length < n) throw new Error('not enough cards to tie');
  const tied = entries.slice(-n);
  const stamp = Math.max(...tied.map((e) => e.placedAt));
  for (const e of tied) e.placedAt = stamp;
}

// =============================================================================
// PLAY: playing a card from hand (CR 8.6.2)
// =============================================================================

describe('PLAY: playing cards from hand', () => {
  it("[PLAY-01] a level 1 card needs a card of its color in its player's level or clock; one match in either zone is enough", () => {
    const at = (level: string[], clock: string[]): GameState => main({ hand: ['R1', 'RE1'], level, clock });

    // One level card, so the level requirement is met, but no red in level or clock.
    const none = at(['Y0'], ['Y0', 'B0']);
    expect(canPlay(none, 'R1')).toBe(false);
    expect(canPlay(none, 'RE1')).toBe(false);
    expect(validate(none, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(none, 0, 'hand', 'R1'), slot: 1 })).toMatchObject({
      ok: false,
      error: { code: 'ILLEGAL_ACTION' },
    });
    expect(attempt(none, { type: 'PLAY_EVENT', player: 0, card: cardIn(none, 0, 'hand', 'RE1') })).toBe('ILLEGAL_ACTION');
    expect(legalActions(none, cat)).toEqual([{ type: 'PASS', player: 0 }]);

    const inLevel = at(['R0'], []);
    const inClock = at(['Y0'], ['R0']);
    const oneOfMany = at(['Y0'], ['Y0', 'B0', 'R0', 'G0']);
    for (const s of [inLevel, inClock, oneOfMany]) {
      expect(canPlay(s, 'R1')).toBe(true);
      expect(canPlay(s, 'RE1')).toBe(true);
    }
    const played = act(inClock, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(inClock, 0, 'hand', 'R1'), slot: 1 });
    expect(stageDefs(played, 0)[0]).toEqual(['R1']);
  });

  it("[PLAY-01] matching colors in other zones (stage, stock, waiting room, memory) or in the opponent's level and clock do not count", () => {
    const s = main(
      { hand: ['R1', 'RE1'], level: ['Y0'], clock: ['Y0'], stage: { 1: 'R0' }, stock: ['R0'], waiting: ['R0'], memory: ['R0'] },
      { deck: FILL, level: ['R0'], clock: ['R0'] },
    );
    expect(canPlay(s, 'R1')).toBe(false);
    expect(canPlay(s, 'RE1')).toBe(false);
    // Contrast: one red card in player 0's own clock is enough.
    const fixed = main({ hand: ['R1', 'RE1'], level: ['Y0'], clock: ['Y0', 'R0'] });
    expect(canPlay(fixed, 'R1')).toBe(true);
    expect(canPlay(fixed, 'RE1')).toBe(true);
  });

  it('[PLAY-01] level 0 characters and level 0 events are exempt from the color requirement', () => {
    for (const [level, clock] of [
      [[], []],
      [['Y0'], ['Y0', 'B0']],
    ] as [string[], string[]][]) {
      const s = main({ hand: ['R0', 'RE0'], level, clock });
      expect(canPlay(s, 'R0'), `level ${level.join()} clock ${clock.join()}`).toBe(true);
      expect(canPlay(s, 'RE0'), `level ${level.join()} clock ${clock.join()}`).toBe(true);
    }
    const s = main({ hand: ['R0', 'RE0'], level: ['Y0'] });
    const after = act(
      s,
      cat,
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'R0'), slot: 2 },
      { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'RE0') },
    );
    expect(stageDefs(after, 0)[1]).toEqual(['R0']);
    expect(defsIn(after, 0, 'waiting')).toEqual(['RE0']);
    // Contrast: the same color situation blocks a level 1 red card.
    expect(canPlay(main({ hand: ['R1'], level: ['Y0'] }), 'R1')).toBe(false);
  });

  it('[PLAY-01] a climax is not exempt: it needs its color in level or clock even though it has no level', () => {
    const at = (level: string[], clock: string[]): GameState => climaxPhase({ hand: ['RX'], level, clock });
    expect(canPlay(at([], []), 'RX')).toBe(false);
    expect(canPlay(at(['Y0'], ['Y0', 'B0']), 'RX')).toBe(false);
    expect(legalActions(at([], []), cat)).toEqual([{ type: 'PASS', player: 0 }]);
    expect(canPlay(at([], ['R0']), 'RX')).toBe(true);
    expect(canPlay(at(['R0'], []), 'RX')).toBe(true);
  });

  it("[PLAY-02] a card's level must not exceed the number of cards in its player's level zone, whatever their colors", () => {
    const defs = ['R2Z', 'RE2', 'R1', 'RE1'];
    // Red is in the clock throughout, so only the level requirement varies.
    const at = (level: string[]): boolean[] => {
      const s = main({ hand: defs, level, clock: ['R0'] });
      return defs.map((d) => canPlay(s, d));
    };
    expect(at([])).toEqual([false, false, false, false]);
    expect(at(['Y0'])).toEqual([false, false, true, true]);
    expect(at(['Y0', 'B0'])).toEqual([true, true, true, true]);
    expect(at(['Y0', 'B0', 'G0'])).toEqual([true, true, true, true]);

    const s = main({ hand: ['R2Z'], level: ['Y0'], clock: ['R0'] });
    expect(attempt(s, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'R2Z'), slot: 1 })).toBe('ILLEGAL_ACTION');

    // Only the player's own level zone counts: the opponent's level cards do not help.
    const theirs = main({ hand: defs, clock: ['R0'] }, { deck: FILL, level: ['R0', 'R0', 'R0'] });
    expect(defs.map((d) => canPlay(theirs, d))).toEqual([false, false, false, false]);
  });

  it('[PLAY-02] climax cards are exempt from the level requirement: one plays with an empty level zone', () => {
    const s = climaxPhase({ hand: ['RX'], clock: ['R0'] });
    expect(s.players[0].level).toEqual([]);
    expect(canPlay(s, 'RX')).toBe(true);
    const card = cardIn(s, 0, 'hand', 'RX');
    const after = act(s, cat, { type: 'PLAY_CLIMAX', player: 0, card });
    expect(eventsOf(since(s, after), 'played')).toEqual([expect.objectContaining({ player: 0, card })]);
    // Contrast: a level 1 card in the same position (red in clock, empty level) is blocked.
    expect(canPlay(main({ hand: ['R1'], clock: ['R0'] }), 'R1')).toBe(false);
  });

  it('[PLAY-01][PLAY-02] both requirements must hold: meeting only the color or only the level is not enough', () => {
    const colorOnly = main({ hand: ['R2Z', 'RE2'], level: ['R0'] });
    const levelOnly = main({ hand: ['R2Z', 'RE2'], level: ['Y0', 'B0'] });
    const both = main({ hand: ['R2Z', 'RE2'], level: ['Y0', 'R0'] });
    for (const d of ['R2Z', 'RE2']) {
      expect(canPlay(colorOnly, d), `${d} with color only`).toBe(false);
      expect(canPlay(levelOnly, d), `${d} with level only`).toBe(false);
      expect(canPlay(both, d), `${d} with both`).toBe(true);
    }
  });

  it("[PLAY-03] playing a character includes choosing one of the player's own five stage positions, empty or occupied", () => {
    const s = main({ hand: ['R0'], stage: { 1: 'Y0', 4: 'B0' } }, { deck: FILL, stage: { 1: 'R1', 3: 'R1' } });
    const card = cardIn(s, 0, 'hand', 'R0');
    const slots = legalActions(s, cat).flatMap((a) => (a.type === 'PLAY_CHARACTER' && a.card === card ? [a.slot] : []));
    expect(slots).toEqual([1, 2, 3, 4, 5]);

    for (const slot of [1, 2, 3, 4, 5] as const) {
      const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot });
      expect(after.players[0].stage[slot - 1]?.map((c) => c.id), `slot ${slot}`).toEqual([card]);
      expect(stageDefs(after, 1), `slot ${slot}`).toEqual(stageDefs(s, 1));
    }
    // There is no position outside 1-5, and no character play without a position.
    for (const slot of [0, 6, 1.5]) expect(attempt(s, { type: 'PLAY_CHARACTER', player: 0, card, slot })).toBe('BAD_SLOT');
    expect(attempt(s, { type: 'PLAY_CHARACTER', player: 0, card })).toBe('BAD_SLOT');
  });

  it('[PLAY-03] an event needs no position: it is offered as a single play', () => {
    const s = main({ hand: ['RE0', 'R0'] });
    const event = cardIn(s, 0, 'hand', 'RE0');
    const character = cardIn(s, 0, 'hand', 'R0');
    const actions = legalActions(s, cat);
    expect(actions.filter((a) => 'card' in a && a.card === event)).toEqual([{ type: 'PLAY_EVENT', player: 0, card: event }]);
    expect(actions.filter((a) => 'card' in a && a.card === character)).toHaveLength(5);
  });

  it('[PLAY-04] a card whose cost is more than the stock cannot be played; a partial payment is never possible', () => {
    const short = main({ hand: ['YK3', 'YEV2'], stock: ['R0'] });
    expect(canPlay(short, 'YK3')).toBe(false);
    expect(canPlay(short, 'YEV2')).toBe(false);
    expect(attempt(short, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(short, 0, 'hand', 'YK3'), slot: 1 })).toBe('ILLEGAL_ACTION');
    expect(attempt(short, { type: 'PLAY_EVENT', player: 0, card: cardIn(short, 0, 'hand', 'YEV2') })).toBe('ILLEGAL_ACTION');

    // One card short is still not enough.
    expect(canPlay(main({ hand: ['YK3'], stock: ['R0', 'R0'] }), 'YK3')).toBe(false);
    // The opponent's stock cannot pay for it.
    const richOpponent = main({ hand: ['YK3', 'YEV2'], stock: ['R0'] }, { deck: FILL, stock: ['R0', 'R0', 'R0', 'R0', 'R0'] });
    expect(canPlay(richOpponent, 'YK3')).toBe(false);
    expect(canPlay(richOpponent, 'YEV2')).toBe(false);

    // Exactly enough: the whole cost is paid.
    const exact = main({ hand: ['YK3', 'YEV2'], stock: ['R0', 'R0', 'R0'] });
    expect(canPlay(exact, 'YK3')).toBe(true);
    expect(canPlay(exact, 'YEV2')).toBe(true);
    const after = act(exact, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(exact, 0, 'hand', 'YK3'), slot: 1 });
    expect(after.players[0].stock).toEqual([]);
    expect(defsIn(after, 0, 'waiting')).toEqual(['R0', 'R0', 'R0']);
    // With the stock spent, the 2-cost event is no longer playable.
    expect(canPlay(after, 'YEV2')).toBe(false);
  });

  it('[PLAY-04] the cost on the card is paid in full from the top of the stock, no more and no less; a cost of 0 pays nothing', () => {
    const s = main({ hand: ['YK3', 'R0'], stock: ['R1', 'B0', 'Y0', 'G0', 'Y2'] });
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'YK3'), slot: 1 });
    const paid = movesOf(since(s, after)).filter((e) => e.reason === 'cost');
    expect(paid.map((e) => defOfId(after, e.card))).toEqual(['Y2', 'G0', 'Y0']);
    for (const e of paid) {
      expect(e.from).toEqual({ player: 0, zone: 'stock' });
      expect(e.to).toEqual({ player: 0, zone: 'waiting' });
    }
    expect(defsIn(after, 0, 'stock')).toEqual(['R1', 'B0']);

    const free = act(after, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(after, 0, 'hand', 'R0'), slot: 2 });
    expect(movesOf(since(after, free)).filter((e) => e.reason === 'cost')).toEqual([]);
    expect(defsIn(free, 0, 'stock')).toEqual(['R1', 'B0']);
  });

  it('[PLAY-05] a card counts as played right after its whole cost is paid, and only then resolves', () => {
    const s = main({ hand: ['YK3', 'YEV2', 'R0'], stock: ['R1', 'R1', 'R1', 'R1', 'R1'] });
    const character = cardIn(s, 0, 'hand', 'YK3');
    const a = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: character, slot: 3 });
    expect(playTrace(since(s, a), character)).toEqual(['cost', 'cost', 'cost', 'played', 'play->stage']);

    const event = cardIn(a, 0, 'hand', 'YEV2');
    const b = act(a, cat, { type: 'PLAY_EVENT', player: 0, card: event });
    expect(playTrace(since(a, b), event)).toEqual(['cost', 'cost', 'played', 'play->resolution', 'eventResolved->waiting']);

    // A cost of 0: "played" still comes before the card is put on the stage.
    const free = cardIn(b, 0, 'hand', 'R0');
    const c = act(b, cat, { type: 'PLAY_CHARACTER', player: 0, card: free, slot: 4 });
    expect(playTrace(since(b, c), free)).toEqual(['played', 'play->stage']);
    expect(eventsOf(since(b, c), 'played')).toEqual([expect.objectContaining({ kind: 'played', player: 0, card: free })]);
  });

  it('[PLAY-05] a climax counts as played before it is put in the climax area', () => {
    const s = climaxPhase({ hand: ['YX'], clock: ['Y0'] });
    const card = cardIn(s, 0, 'hand', 'YX');
    const after = act(s, cat, { type: 'PLAY_CLIMAX', player: 0, card });
    expect(playTrace(since(s, after), card).slice(0, 2)).toEqual(['played', 'play->climax']);
  });

  it('[PLAY-06] a character played onto an occupied position goes there, and the earlier one goes to the waiting room by rule action at the next check timing', () => {
    const s = main({ hand: ['R0'], stage: { 2: { def: 'Y0', orientation: 'rest' } } });
    const old = cardIn(s, 0, 'stage', 'Y0');
    const card = cardIn(s, 0, 'hand', 'R0');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 2 });

    expect(after.players[0].stage[1]).toEqual([expect.objectContaining({ id: card, orientation: 'stand' })]);
    expect(after.players[0].waiting).toEqual([old]);

    const ev = since(s, after);
    const placed = ev.findIndex((e) => e.kind === 'move' && e.card === card && e.to.zone === 'stage');
    const check = ev.findIndex((e, i) => i > placed && e.kind === 'checkTiming');
    const rule = ev.findIndex((e) => e.kind === 'ruleAction');
    const removed = ev.findIndex((e) => e.kind === 'move' && e.card === old);
    expect(placed).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(placed);
    expect(rule).toBeGreaterThan(check);
    expect(removed).toBeGreaterThan(rule);
    expect(ev[rule]).toMatchObject({ kind: 'ruleAction', rule: 'extraCards', cards: [old], players: [0] });
    expect(ev[removed]).toMatchObject({ from: { player: 0, zone: 'stage', slot: 2 }, to: { player: 0, zone: 'waiting' }, reason: 'ruleAction' });
    expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[PLAY-06] contrast: a character played onto an empty position displaces nothing', () => {
    const s = main({ hand: ['R0'], stage: { 2: 'Y0' } });
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'R0'), slot: 3 });
    expect(stageDefs(after, 0)).toEqual([[], ['Y0'], ['R0'], [], []]);
    expect(eventsOf(since(s, after), 'ruleAction')).toEqual([]);
    expect(after.players[0].waiting).toEqual([]);
  });

  it("[PLAY-06] the displaced character goes to its owner's waiting room, even when its owner is the other player", () => {
    const s = main({ hand: ['R0'] }, { deck: FILL, hand: ['B0'] });
    const foreign = cardIn(s, 1, 'hand', 'B0');
    // Only card effects (M3) can put an opponent-owned character on a stage, so place it directly.
    const t = ops.deepClone(s);
    ops.moveCard(t, foreign, { player: 0, zone: 'stage', slot: 3 }, 'effect');
    const after = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(t, 0, 'hand', 'R0'), slot: 3 });
    expect(stageDefs(after, 0)[2]).toEqual(['R0']);
    expect(after.players[1].waiting).toEqual([foreign]);
    expect(after.players[0].waiting).toEqual([]);
  });

  it("[PLAY-07] a played event is put in its player's resolution zone, then into its owner's waiting room after it resolves", () => {
    const s = main({ hand: ['YEV2'], stock: ['R0', 'R0'], waiting: ['B0'] });
    const card = cardIn(s, 0, 'hand', 'YEV2');
    const after = act(s, cat, { type: 'PLAY_EVENT', player: 0, card });
    const moves = movesOf(since(s, after)).filter((e) => e.card === card);
    expect(moves.map((e) => [e.from, e.to, e.reason])).toEqual([
      [{ player: 0, zone: 'hand' }, { player: 0, zone: 'resolution' }, 'play'],
      [{ player: 0, zone: 'resolution' }, { player: 0, zone: 'waiting' }, 'eventResolved'],
    ]);
    expect(after.players[0].resolution).toEqual([]);
    expect(after.players[0].waiting.at(-1)).toBe(card);
    expect(stageDefs(after, 0)).toEqual([[], [], [], [], []]);
    expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it("[PLAY-08] a played climax is placed in its player's climax area and stays there until the end phase", () => {
    const s = climaxPhase({ hand: ['YX'], clock: ['Y0'] });
    const card = cardIn(s, 0, 'hand', 'YX');
    const after = act(s, cat, { type: 'PLAY_CLIMAX', player: 0, card });
    const ev = since(s, after);
    const moves = movesOf(ev).filter((e) => e.card === card);
    expect(moves.map((e) => [e.from, e.to, e.reason])).toEqual([
      [{ player: 0, zone: 'hand' }, { player: 0, zone: 'climax' }, 'play'],
      [{ player: 0, zone: 'climax' }, { player: 0, zone: 'waiting' }, 'climaxCleanup'],
    ]);
    // Nothing removed it as illegal; it left only through the end-phase cleanup.
    const between = ev.slice(ev.indexOf(nth(moves, 0)), ev.indexOf(nth(moves, 1)));
    expect(eventsOf(between, 'phase').map((e) => e.phase)).toEqual(['attack', 'end']);
    expect(eventsOf(ev, 'ruleAction')).toEqual([]);
  });

  it('[PLAY-08][ILL-02] a climax played while another is in the climax area stays; the earlier one goes to the waiting room at the check timing', () => {
    const s = climaxPhase({ hand: ['YX'], clock: ['Y0'], climax: ['BX'] });
    // The lone BX passed the climax phase's opening check timing untouched.
    expect(climaxDefs(s, 0)).toEqual(['BX']);
    const old = cardIn(s, 0, 'climax', 'BX');
    const card = cardIn(s, 0, 'hand', 'YX');
    const after = act(s, cat, { type: 'PLAY_CLIMAX', player: 0, card });
    const ev = since(s, after);

    expect(eventsOf(ev, 'ruleAction')).toEqual([expect.objectContaining({ rule: 'extraCards', cards: [old], players: [0] })]);
    const oldMove = movesOf(ev).find((e) => e.card === old);
    expect(oldMove).toMatchObject({ from: { player: 0, zone: 'climax' }, to: { player: 0, zone: 'waiting' }, reason: 'ruleAction' });
    expect(ev.indexOf(oldMove as GameEvent)).toBeLessThan(ev.findIndex((e) => e.kind === 'phase' && e.phase === 'attack'));
    // The new climax was never removed by a rule action.
    expect(movesOf(ev).filter((e) => e.card === card).map((e) => e.reason)).toEqual(['play', 'climaxCleanup']);
  });

  it("[PLAY-03][PLAY-07][PLAY-08] a played card goes to the player's own stage position, resolution zone or climax area even when the other player owns it; a resolved event then goes to its owner's waiting room", () => {
    // Only card effects (M3) can put an opponent-owned card into a hand, so move them there directly.
    const s = main({ hand: ['G0'], clock: ['R0'] }, { deck: FILL, hand: ['B0', 'YE0', 'RX'] });
    const t = ops.deepClone(s);
    const character = cardIn(t, 1, 'hand', 'B0');
    const event = cardIn(t, 1, 'hand', 'YE0');
    const climax = cardIn(t, 1, 'hand', 'RX');
    for (const c of [character, event, climax]) ops.moveCard(t, c, { player: 0, zone: 'hand' }, 'effect');

    // PLAY-03: the positions offered are the player's own, and the card lands there.
    const slots = legalActions(t, cat).flatMap((a) => (a.type === 'PLAY_CHARACTER' && a.card === character ? [a.slot] : []));
    expect(slots).toEqual([1, 2, 3, 4, 5]);
    const a = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card: character, slot: 4 });
    expect(a.players[0].stage[3]?.map((c) => c.id)).toEqual([character]);
    expect(a.players[1].stage.flat()).toEqual([]);

    // PLAY-07: the player's resolution zone, then the owner's waiting room.
    const b = act(a, cat, { type: 'PLAY_EVENT', player: 0, card: event });
    expect(movesOf(since(a, b)).filter((e) => e.card === event).map((e) => [e.to, e.reason])).toEqual([
      [{ player: 0, zone: 'resolution' }, 'play'],
      [{ player: 1, zone: 'waiting' }, 'eventResolved'],
    ]);
    expect(b.players[1].waiting.at(-1)).toBe(event);
    expect(b.players[0].waiting).toEqual([]);

    // PLAY-08: the player's climax area (red is in player 0's clock, so the color requirement is met).
    const c = act(b, cat, { type: 'PASS', player: 0 });
    expect(c.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    const d = act(c, cat, { type: 'PLAY_CLIMAX', player: 0, card: climax });
    const placed = movesOf(since(c, d)).find((e) => e.card === climax && e.reason === 'play');
    expect(placed?.to).toEqual({ player: 0, zone: 'climax' });
    expect(eventsOf(since(c, d), 'ruleAction')).toEqual([]);
  });
});

// =============================================================================
// RULE: the two types of rule action (CR 9.1)
// =============================================================================

describe('RULE: interrupt and check rule actions', () => {
  it('[RULE-01][LVL-01] a level up cuts into the clock-phase action: it happens as the seventh card lands, before either draw', () => {
    const s = makeState(cat, { players: [{ deck: FILL, hand: ['R1', 'Y0'], clock: SIX }, { deck: FILL }], start: 'clock' });
    const clocked = cardIn(s, 0, 'hand', 'R1');
    const mid = act(s, cat, { type: 'CLOCK', player: 0, card: clocked });

    expect(mid.pending).toEqual({ kind: 'levelUp', player: 0, options: mid.players[0].clock.slice(0, 7) });
    expect(mid.players[0].clock).toHaveLength(7);
    expect(defsIn(mid, 0, 'hand')).toEqual(['Y0']);
    expect(marks(since(s, mid))).toEqual(['clock']);

    const after = act(mid, cat, { type: 'LEVEL_UP', player: 0, card: clocked });
    expect(marks(since(mid, after)).slice(0, 3)).toEqual(['level', 'draw', 'draw']);
    expect(after.players[0].hand).toHaveLength(3);
  });

  it('[RULE-01][REF-01] a refresh cuts in between the two clock-phase draws without waiting for a check timing', () => {
    const s = makeState(cat, { players: [{ deck: ['G0'], waiting: ['Y0', 'R0', 'B0'], hand: ['R1'] }, { deck: FILL }], start: 'clock' });
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'R1') });
    expect(marks(since(s, after)).slice(0, 5)).toEqual(['clock', 'draw', 'refresh:0', 'refreshClock', 'draw']);
    expect(after.players[0].hand).toHaveLength(2);
  });

  it('[RULE-01] a refresh also cuts into the mulligan redraw: after one card the rest are drawn from the refreshed deck', () => {
    const s = makeState(cat, { players: [{ deck: ['G0'], hand: ['Y0', 'R0', 'B0'] }, { deck: FILL, hand: ['G0'] }], start: 'mulligan' });
    const discard = [cardIn(s, 0, 'hand', 'Y0'), cardIn(s, 0, 'hand', 'R0'), cardIn(s, 0, 'hand', 'B0')];
    const after = act(s, cat, { type: 'MULLIGAN', player: 0, discard });
    expect(marks(since(s, after))).toEqual(['draw', 'refresh:0', 'refreshClock', 'draw', 'draw']);
    expect(after.players[0].hand).toHaveLength(3);
    expect(after.pending).toEqual({ kind: 'mulligan', player: 1 });
  });

  it('[RULE-02] two refreshes due at once: the turn player refreshes first, then the non-turn player, whichever seat has the turn', () => {
    for (const active of [0, 1] as const) {
      const zones = (): ZoneSpec => ({ deck: [], waiting: ['G0', 'G0', 'G0'], hand: ['G0'] });
      const s = makeState(cat, { players: [zones(), zones()], active, start: 'main' });
      expect(eventsOf(s.log, 'refresh').map((e) => e.player), `turn player ${active}`).toEqual([active, other(active)]);
      // The turn player's refresh is complete, top card in clock, before the other one starts.
      const firstDone = s.log.findIndex((e) => e.kind === 'move' && e.reason === 'refreshClock' && e.to.player === active);
      const secondStarts = s.log.findIndex((e) => e.kind === 'refresh' && e.player === other(active));
      expect(firstDone).toBeGreaterThanOrEqual(0);
      expect(secondStarts).toBeGreaterThan(firstDone);
    }
  });

  it("[RULE-02] the turn player chooses the order of their own two due interrupts and does both before the non-turn player's", () => {
    const s = main({ deck: [], waiting: ['G0', 'G0', 'G0'], clock: SEVEN }, { deck: FILL, clock: SEVEN });
    expect(s.pending).toMatchObject({ kind: 'interruptOrder', player: 0 });
    expect(legalActions(s, cat).map((a) => (a.type === 'CHOOSE_INTERRUPT' ? a.interrupt : a.type)).sort()).toEqual(['levelUp', 'refresh']);
    expect(attempt(s, { type: 'LEVEL_UP', player: 1, card: cardIn(s, 1, 'clock', 'Y2') })).toBe('NOT_YOUR_DECISION');
    expect(eventsOf(s.log, 'refresh')).toEqual([]);

    // Order A: level up first, then the refresh, then the opponent.
    let a = act(s, cat, { type: 'CHOOSE_INTERRUPT', player: 0, interrupt: 'levelUp' });
    expect(a.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    expect(eventsOf(a.log, 'refresh')).toEqual([]);
    a = act(a, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(a, 0, 'clock', 'Y2') });
    expect(eventsOf(a.log, 'refresh').map((e) => e.player)).toEqual([0]);
    expect(a.players[0].deck).toHaveLength(8); // 3 + the 6 level-up cards, less the one put into clock
    expect(a.players[0].clock).toHaveLength(1);
    expect(a.pending).toMatchObject({ kind: 'levelUp', player: 1 });

    // Order B: refresh first; the turn player's level up still comes before the opponent's.
    let b = act(s, cat, { type: 'CHOOSE_INTERRUPT', player: 0, interrupt: 'refresh' });
    expect(eventsOf(b.log, 'refresh').map((e) => e.player)).toEqual([0]);
    expect(b.players[0].clock).toHaveLength(8);
    expect(b.pending).toEqual({ kind: 'levelUp', player: 0, options: b.players[0].clock.slice(0, 7) });
    b = act(b, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(b, 0, 'clock', 'Y2') });
    expect(b.players[0].deck).toHaveLength(2);
    expect(b.pending).toMatchObject({ kind: 'levelUp', player: 1 });
  });

  it('[RULE-02] the non-turn player waits for the turn player, then chooses the order of their own two due interrupts', () => {
    const s = main({ hand: ['G0'], clock: SEVEN }, { deck: [], waiting: ['G0', 'G0'], clock: SEVEN });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    // Player 1's refresh was due from the start, but waits for the turn player's level up.
    expect(eventsOf(s.log, 'refresh')).toEqual([]);
    const t = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y2') });
    expect(t.pending).toMatchObject({ kind: 'interruptOrder', player: 1 });
    expect(legalActions(t, cat).map((a) => (a.type === 'CHOOSE_INTERRUPT' ? a.interrupt : a.type)).sort()).toEqual(['levelUp', 'refresh']);
    expect(attempt(t, { type: 'CHOOSE_INTERRUPT', player: 0, interrupt: 'refresh' })).toBe('NOT_YOUR_DECISION');
    const u = act(t, cat, { type: 'CHOOSE_INTERRUPT', player: 1, interrupt: 'refresh' });
    expect(eventsOf(u.log, 'refresh').map((e) => e.player)).toEqual([1]);
    expect(u.pending).toMatchObject({ kind: 'levelUp', player: 1 });
  });

  it('[RULE-03][PWR-01] a check-type rule action never fires mid-action: a 0-power character played to the stage stays there until the check timing', () => {
    const s = main({ hand: ['Z0'] });
    const card = cardIn(s, 0, 'hand', 'Z0');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 2 });
    const trace = since(s, after).flatMap((e): string[] => {
      if (e.kind === 'move' && e.card === card) return [`${e.reason}->${e.to.zone}`];
      if (e.kind === 'checkTiming') return ['check'];
      if (e.kind === 'ruleAction') return [`rule:${e.rule}`];
      if (e.kind === 'playTiming') return ['playTiming'];
      return [];
    });
    expect(trace).toEqual(['play->stage', 'check', 'rule:insufficientPower', 'ruleAction->waiting', 'playTiming']);
    expect(after.players[0].waiting).toEqual([card]);
  });

  it('[RULE-03][VERD-02] a losing condition that holds only partway through a chain of interrupts, and is gone by the check timing, does nothing', () => {
    // The refresh turns the single waiting-room card into the deck and puts it straight into the
    // clock: for a moment deck and waiting room are both empty. The seventh clock card then forces
    // a level up, which refills the waiting room before any check timing.
    const s = main({ deck: [], waiting: ['B1'], clock: SIX, hand: ['G0'] });
    expect(s.players[0].deck).toEqual([]);
    expect(s.players[0].waiting).toEqual([]);
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    expect(eventsOf(s.log, 'checkTiming')).toEqual([]);
    expect(s.result).toBeNull();

    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y2') });
    expect(after.result).toBeNull();
    expect(eventsOf(after.log, 'ruleAction')).toEqual([]);
    expect(eventsOf(after.log, 'checkTiming').length).toBeGreaterThan(0);
    expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    // Contrast: without the level up the condition still holds at the check timing, and the player loses.
    const lost = main({ deck: [], waiting: ['B1'], clock: SIX.slice(0, 5), hand: ['G0'] });
    expect(lost.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
  });

  it('[RULE-03] every check-type rule action due at a check timing is carried out together, for both players, before play continues', () => {
    const s = main(
      { hand: ['G0'], stage: { 1: 'Z0', 2: ['Y0', 'R0'], 3: 'YE0' }, climax: ['RX', 'YX'] },
      { deck: FILL, stage: { 1: 'RX', 4: 'Z0' }, climax: ['R0'] },
    );
    expect(stageDefs(s, 0)).toEqual([[], ['R0'], [], [], []]);
    expect(climaxDefs(s, 0)).toEqual(['YX']);
    expect(stageDefs(s, 1)).toEqual([[], [], [], [], []]);
    expect(climaxDefs(s, 1)).toEqual([]);
    expect(sorted(defsIn(s, 0, 'waiting'))).toEqual(sorted(['Z0', 'Y0', 'YE0', 'RX']));
    expect(sorted(defsIn(s, 1, 'waiting'))).toEqual(sorted(['RX', 'Z0', 'R0']));

    // One check timing: every rule action is judged before any card moves, and all of it
    // happens before the play timing opens.
    const from = s.log.findIndex((e) => e.kind === 'checkTiming');
    const to = s.log.findIndex((e) => e.kind === 'playTiming');
    const window = s.log.slice(from, to);
    const kinds = window.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'checkTiming')).toHaveLength(1);
    expect(kinds.lastIndexOf('ruleAction')).toBeLessThan(kinds.indexOf('move'));
    const moves = movesOf(window);
    expect(moves).toHaveLength(7);
    expect(moves.every((e) => e.reason === 'ruleAction')).toBe(true);
    expect(sorted(eventsOf(window, 'ruleAction').flatMap((e) => e.cards))).toEqual(sorted(moves.map((e) => e.card)));
  });

  it('[RULE-03][ILL-02][PWR-01] rule actions due together happen together: a 0-power character played onto an occupied position takes the old one with it', () => {
    const s = main({ hand: ['Z0'], stage: { 1: 'Y0' } });
    const old = cardIn(s, 0, 'stage', 'Y0');
    const card = cardIn(s, 0, 'hand', 'Z0');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    // Both were judged on the same snapshot: Y0 is not the newest card there, and Z0 has 0 power.
    // Removing Z0 first would have left Y0 alone on the position, and it would have stayed.
    expect(stageDefs(after, 0)[0]).toEqual([]);
    expect(sorted(after.players[0].waiting)).toEqual(sorted([old, card]));
    const ev = since(s, after);
    expect(eventsOf(ev, 'checkTiming')).toHaveLength(1);
    const rules = eventsOf(ev, 'ruleAction');
    expect(rules.map((e) => [e.rule, e.cards])).toEqual(
      expect.arrayContaining([
        ['extraCards', [old]],
        ['insufficientPower', [card]],
      ]),
    );
    const lastRule = Math.max(...rules.map((e) => ev.indexOf(e)));
    const removals = movesOf(ev).filter((e) => e.reason === 'ruleAction');
    expect(removals).toHaveLength(2);
    for (const m of removals) expect(ev.indexOf(m)).toBeGreaterThan(lastRule);
  });

  it('[RULE-03][VERD-02] the losing verdict uses the same snapshot as the other check-type actions: a 0-power character going to an empty waiting room does not save its player', () => {
    // Had the 0-power removal come first, player 1 would have a waiting-room card to refresh with.
    const s = main({ hand: ['G0'] }, { deck: [], waiting: [], stage: { 1: 'Z0' } });
    expect(s.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'deckOut' });
    // Contrast: with one card already in the waiting room there is a refresh instead, and no loss.
    const t = main({ hand: ['G0'] }, { deck: [], waiting: ['R0', 'R0'], stage: { 1: 'Z0' } });
    expect(t.result).toBeNull();
  });
});

// =============================================================================
// REF: refresh (CR 9.2)
// =============================================================================

describe('REF: refresh', () => {
  it('[REF-01] when the deck is empty the whole waiting room goes into the deck, the deck is shuffled, then its top card goes to the clock', () => {
    const s = main({ deck: [], waiting: ['Y0', 'R0', 'B0', 'G0'], hand: ['G0'] });
    const refreshAt = s.log.findIndex((e) => e.kind === 'refresh');
    expect(s.log[refreshAt]).toMatchObject({ kind: 'refresh', player: 0 });
    const ev = s.log.slice(refreshAt);
    const intoDeck = movesOf(ev).filter((e) => e.reason === 'refresh');
    expect(intoDeck).toHaveLength(4);
    for (const e of intoDeck) {
      expect(e.from).toEqual({ player: 0, zone: 'waiting' });
      expect(e.to).toEqual({ player: 0, zone: 'deck' });
    }
    const shuffleAt = ev.findIndex((e) => e.kind === 'shuffle' && e.player === 0);
    const toClock = movesOf(ev).filter((e) => e.reason === 'refreshClock');
    expect(toClock).toHaveLength(1);
    const clockAt = ev.indexOf(nth(toClock, 0));
    expect(shuffleAt).toBeGreaterThan(ev.indexOf(nth(intoDeck, 3)));
    expect(clockAt).toBeGreaterThan(shuffleAt);
    expect(toClock[0]).toMatchObject({ from: { player: 0, zone: 'deck' }, to: { player: 0, zone: 'clock' } });
    // No check timing or decision in between: it is one uninterrupted resolution.
    expect(ev.slice(0, clockAt).some((e) => e.kind === 'checkTiming')).toBe(false);

    expect(s.players[0].waiting).toEqual([]);
    expect(s.players[0].clock).toEqual([nth(toClock, 0).card]);
    expect(s.players[0].deck).toHaveLength(3);
    expect(sorted([...defsIn(s, 0, 'deck'), ...defsIn(s, 0, 'clock')])).toEqual(sorted(['Y0', 'R0', 'B0', 'G0']));
    expect(s.result).toBeNull();
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[REF-01] the new deck is the whole waiting room after a shuffle, and the card put into clock is the top card of that shuffled deck', () => {
    const s = makeState(cat, {
      players: [{ deck: ['G0'], waiting: ['Y0', 'R0', 'B0', 'Y1', 'B1', 'R1', 'Y0b', 'R3'], hand: ['Y2'] }, { deck: FILL }],
      start: 'clock',
    });
    const clocked = cardIn(s, 0, 'hand', 'Y2');
    const drawnFirst = cardIn(s, 0, 'deck', 'G0');
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: clocked });
    const ev = since(s, after);
    // The order the cards entered the deck, then the shuffle the game's seeded generator gives
    // for that deck (the refresh is the only random step in this action).
    const intoDeck = movesOf(ev)
      .filter((e) => e.reason === 'refresh')
      .map((e) => e.card);
    expect(sorted(intoDeck)).toEqual(sorted(s.players[0].waiting));
    const [shuffled] = shuffle(s.rng, intoDeck);
    expect(shuffled).not.toEqual(intoDeck); // the shuffle really changes the order here

    const top = nth(shuffled, shuffled.length - 1);
    const next = nth(shuffled, shuffled.length - 2);
    expect(movesOf(ev).filter((e) => e.reason === 'refreshClock').map((e) => e.card)).toEqual([top]);
    expect(after.players[0].clock).toEqual([clocked, top]);
    // The second clock-phase draw takes the card that was right below it, and the rest stay in shuffled order.
    expect(after.players[0].hand).toEqual([drawnFirst, next]);
    expect(after.players[0].deck).toEqual(shuffled.slice(0, -2));
  });

  it("[REF-01] the refresh belongs to the deck's owner and happens even on the opponent's turn; a deck with cards is never refreshed", () => {
    const s = main({ hand: ['G0'], waiting: ['Y0', 'Y0'] }, { deck: [], waiting: ['R0', 'R1', 'B0'] });
    expect(eventsOf(s.log, 'refresh').map((e) => e.player)).toEqual([1]);
    expect(s.players[1].deck).toHaveLength(2);
    expect(s.players[1].clock).toHaveLength(1);
    expect(defsIn(s, 0, 'waiting')).toEqual(['Y0', 'Y0']);
    expect(s.players[0].deck).toHaveLength(FILL.length);
  });

  it('[REF-01][LVL-01] the card a refresh puts into the clock can itself cause a level up', () => {
    const s = main({ deck: [], waiting: ['G0', 'G0', 'G0'], clock: SIX, hand: ['G0'] });
    expect(eventsOf(s.log, 'refresh')).toHaveLength(1);
    expect(s.players[0].clock).toHaveLength(7);
    expect(s.pending).toEqual({ kind: 'levelUp', player: 0, options: s.players[0].clock.slice(0, 7) });
  });

  it('[REF-01] no refresh happens while a cost is being paid: it waits until the whole cost is paid, then refreshes once with every paid card', () => {
    const s = main({ deck: ['G0'], hand: ['YK2'], stock: ['Y0', 'R0'] });
    // A play timing with an empty deck and an empty waiting room cannot come from actions alone
    // (the check timing before it would end the game), so empty the deck directly.
    const t = ops.deepClone(s);
    ops.moveCard(t, cardIn(t, 0, 'deck', 'G0'), { player: 0, zone: 'memory' }, 'effect');
    expect(t.players[0].deck).toEqual([]);
    expect(t.players[0].waiting).toEqual([]);

    const card = cardIn(t, 0, 'hand', 'YK2');
    const after = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    const ev = since(t, after);
    const paid = movesOf(ev).filter((e) => e.reason === 'cost');
    expect(paid).toHaveLength(2);
    expect(eventsOf(ev, 'refresh')).toHaveLength(1);
    const refreshAt = ev.findIndex((e) => e.kind === 'refresh');
    expect(refreshAt).toBeGreaterThan(ev.indexOf(nth(paid, 1)));
    expect(sorted(movesOf(ev).filter((e) => e.reason === 'refresh').map((e) => e.card))).toEqual(sorted(paid.map((e) => e.card)));
    expect(after.players[0].deck).toHaveLength(1);
    expect(after.players[0].clock).toHaveLength(1);
    expect(after.players[0].waiting).toEqual([]);
    expect(after.result).toBeNull();
  });

  it('[REF-01][RULE-01] a refresh that became due during cost payment happens as soon as the payment ends, before the card counts as played and resolves', () => {
    const s = main({ deck: ['G0'], hand: ['YK2'], stock: ['Y0', 'R0'] });
    // Same position as above: an empty deck and an empty waiting room at a play timing.
    const t = ops.deepClone(s);
    ops.moveCard(t, cardIn(t, 0, 'deck', 'G0'), { player: 0, zone: 'memory' }, 'effect');
    const card = cardIn(t, 0, 'hand', 'YK2');
    const after = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    // Interrupt rule actions run the moment their condition holds; only the payment itself holds them back.
    expect(marks(since(t, after)).slice(0, 5)).toEqual(['cost', 'cost', 'refresh:0', 'refreshClock', 'played']);
  });

  it('[REF-02][VERD-02] if the deck runs out while the waiting room is empty the refresh just ends: nothing moves, and the loss comes at the check timing', () => {
    const s = makeState(cat, { players: [{ deck: ['G0'], hand: ['R1'] }, { deck: FILL }], start: 'clock' });
    const clocked = cardIn(s, 0, 'hand', 'R1');
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: clocked });
    // First draw empties the deck; there is nothing to refresh with and the second draw does nothing.
    expect(marks(since(s, after))).toEqual(['clock', 'draw', 'check', 'rule:loss', 'gameOver']);
    expect(eventsOf(since(s, after), 'refresh')).toEqual([]);
    expect(after.players[0].clock).toEqual([clocked]);
    expect(defsIn(after, 0, 'hand')).toEqual(['G0']);
    expect(after.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
  });

  it('[REF-02] after a refresh ends for lack of cards no new refresh happens until the waiting room gets cards; then one happens at once', () => {
    // The refresh empties both zones (the single waiting-room card goes deck -> clock).
    const s = main({ deck: [], waiting: ['B1'], clock: SIX, hand: ['G0'] });
    expect(eventsOf(s.log, 'refresh')).toHaveLength(1);
    expect(s.players[0].deck).toEqual([]);
    expect(s.players[0].waiting).toEqual([]);
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });

    // The level up puts six cards into the waiting room while the deck is still empty.
    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y2') });
    const ev = since(s, after);
    expect(marks(ev).slice(0, 3)).toEqual(['level', 'refresh:0', 'refreshClock']);
    expect(eventsOf(after.log, 'refresh')).toHaveLength(2);
    expect(after.players[0].deck).toHaveLength(5);
    expect(after.players[0].clock).toHaveLength(1);
    expect(after.players[0].level).toHaveLength(1);
    expect(after.result).toBeNull();
  });
});

// =============================================================================
// LVL: level up (CR 9.3)
// =============================================================================

describe('LVL: level up', () => {
  it('[LVL-01] with seven cards in clock the player picks any one of them for the level zone and the other six go to their waiting room', () => {
    const s = main({ hand: ['G0'], clock: SEVEN });
    const clock = [...s.players[0].clock];
    expect(s.pending).toEqual({ kind: 'levelUp', player: 0, options: clock });
    expect(sorted(legalActions(s, cat).map((a) => (a.type === 'LEVEL_UP' ? a.card : a.type)))).toEqual(sorted(clock));
    for (const chosen of clock) {
      const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: chosen });
      expect(after.players[0].level).toEqual([chosen]);
      expect(after.players[0].clock).toEqual([]);
      expect(sorted(after.players[0].waiting)).toEqual(sorted(clock.filter((c) => c !== chosen)));
      expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    }
  });

  it('[LVL-01] six cards in clock is not enough for a level up', () => {
    const s = main({ hand: ['G0'], clock: SIX });
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(s.players[0].clock).toHaveLength(6);
    expect(s.players[0].level).toEqual([]);
  });

  it('[LVL-01] with more than seven clock cards only the bottom seven are processed; the cards above them stay in the clock', () => {
    const s = main({ hand: ['G0'], clock: [...SEVEN, 'G0', 'B1'] });
    const clock = [...s.players[0].clock];
    const top = clock.slice(7);
    expect(s.pending).toEqual({ kind: 'levelUp', player: 0, options: clock.slice(0, 7) });
    for (const c of top) expect(attempt(s, { type: 'LEVEL_UP', player: 0, card: c })).toBe('ILLEGAL_ACTION');

    const chosen = nth(clock, 3);
    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: chosen });
    expect(after.players[0].level).toEqual([chosen]);
    expect(after.players[0].clock).toEqual(top);
    expect(sorted(after.players[0].waiting)).toEqual(sorted(clock.slice(0, 7).filter((c) => c !== chosen)));
  });

  it('[LVL-01] cards left in the clock can cause another level up straight away', () => {
    const s = main({ hand: ['G0'], clock: [...SEVEN, ...SEVEN] });
    const clock = [...s.players[0].clock];
    expect(s.pending).toEqual({ kind: 'levelUp', player: 0, options: clock.slice(0, 7) });
    const t = act(s, cat, { type: 'LEVEL_UP', player: 0, card: nth(clock, 0) });
    expect(t.pending).toEqual({ kind: 'levelUp', player: 0, options: clock.slice(7) });
    expect(eventsOf(since(s, t), 'checkTiming')).toEqual([]);
    const u = act(t, cat, { type: 'LEVEL_UP', player: 0, card: nth(clock, 7) });
    expect(u.players[0].level).toEqual([nth(clock, 0), nth(clock, 7)]);
    expect(u.players[0].clock).toEqual([]);
    expect(u.players[0].waiting).toHaveLength(12);
    expect(u.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it("[LVL-01] the level up is the clock owner's decision, even on the opponent's turn, and the six cards may be put in the waiting room in any order", () => {
    const s = main({ hand: ['G0'] }, { deck: FILL, clock: SEVEN });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 1 });
    const chosen = cardIn(s, 1, 'clock', 'Y2');
    expect(attempt(s, { type: 'LEVEL_UP', player: 0, card: chosen })).toBe('NOT_YOUR_DECISION');
    const after = act(s, cat, { type: 'LEVEL_UP', player: 1, card: chosen });
    expect(after.players[1].level).toEqual([chosen]);
    expect(after.players[0].level).toEqual([]);
    const six = [...after.players[1].waiting];
    expect(six).toHaveLength(6);
    const reordered = [nth(six, 3), nth(six, 0), nth(six, 5), nth(six, 1), nth(six, 4), nth(six, 2)];
    const arranged = act(after, cat, { type: 'REORDER', player: 1, zone: 'waiting', order: reordered });
    expect(arranged.players[1].waiting).toEqual(reordered);
  });
});

// =============================================================================
// VERD: losing verdict (CR 9.4)
// =============================================================================

describe('VERD: losing verdict', () => {
  it('[VERD-01] a player with four or more level cards loses at the check timing; three is not a losing condition', () => {
    const at = (n0: number, n1: number): GameState =>
      main({ hand: ['G0'], level: Array<string>(n0).fill('Y0') }, { deck: FILL, level: Array<string>(n1).fill('R0') });
    const safe = at(3, 3);
    expect(safe.result).toBeNull();
    expect(safe.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    const four = at(0, 4);
    expect(four.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
    expect(marks(four.log)).toEqual(['check', 'rule:loss', 'gameOver']);
    expect(eventsOf(four.log, 'playTiming')).toEqual([]);
    expect(at(5, 0).result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
  });

  it('[VERD-01] reaching level 4 is judged at the next check timing, not the moment the fourth level card arrives', () => {
    const s = makeState(cat, {
      players: [{ deck: FILL, hand: ['R1', 'G0'], level: ['Y0', 'Y0', 'Y0'], clock: SIX }, { deck: FILL }],
      start: 'clock',
    });
    const mid = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'R1') });
    expect(mid.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    const after = act(mid, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(mid, 0, 'clock', 'Y2') });
    // The level card lands, the clock-phase draws still finish, and only then is the loss judged.
    expect(marks(since(mid, after))).toEqual(['level', 'draw', 'draw', 'check', 'rule:loss', 'gameOver']);
    expect(after.players[0].level).toHaveLength(4);
    expect(after.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
  });

  it('[VERD-01] every player meeting a losing condition at that check timing loses, so two losers make a draw', () => {
    const both = main({ level: ['Y0', 'Y0', 'Y0', 'Y0'] }, { deck: FILL, level: ['R0', 'R0', 'R0', 'R0'] });
    expect(both.result).toEqual({ kind: 'draw', reasons: ['level4', 'level4'] });
    expect(eventsOf(both.log, 'ruleAction')).toEqual([expect.objectContaining({ rule: 'loss', players: [0, 1] })]);
    const mixed = main({ level: ['Y0', 'Y0', 'Y0', 'Y0'] }, { deck: [], waiting: [], hand: ['R0'] });
    expect(mixed.result).toEqual({ kind: 'draw', reasons: ['level4', 'deckOut'] });
  });

  it('[VERD-02] a player with no cards in deck or waiting room loses at the next check timing; contrast: keeping a deck card avoids it', () => {
    const s = makeState(cat, { players: [{ deck: ['G0'], hand: ['R1'] }, { deck: FILL }], start: 'clock' });
    expect(s.result).toBeNull();
    const out = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'R1') });
    expect(out.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
    expect(eventsOf(since(s, out), 'ruleAction')).toEqual([expect.objectContaining({ rule: 'loss', players: [0] })]);

    const kept = act(s, cat, { type: 'CLOCK', player: 0, card: null });
    expect(kept.result).toBeNull();
    expect(kept.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[VERD-02] both zones must be empty: an empty deck alone leads to a refresh and an empty waiting room alone is fine, for either player', () => {
    const deckOnly = main({ deck: [], waiting: ['Y0', 'R0'], hand: ['G0'] }, { deck: [], waiting: ['B0', 'B0'] });
    expect(deckOnly.result).toBeNull();
    expect(eventsOf(deckOnly.log, 'refresh').map((e) => e.player)).toEqual([0, 1]);

    const waitingOnly = main({ deck: ['G0'], waiting: [], hand: ['G0'] }, { deck: ['G0'], waiting: [] });
    expect(waitingOnly.result).toBeNull();
    expect(waitingOnly.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    const nonTurn = main({ hand: ['G0'] }, { deck: [], waiting: [] });
    expect(nonTurn.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'deckOut' });
  });
});

// =============================================================================
// PWR and ILL: insufficient power and illegal cards (CR 9.5, 9.6)
// =============================================================================

describe('PWR and ILL: insufficient power and illegal cards', () => {
  it("[PWR-01] at a check timing every character with 0 power goes to its owner's waiting room, on both stages; a 1-power character stays", () => {
    const s = main({ hand: ['G0'], stage: { 1: 'Z0', 2: 'P1' } }, { deck: FILL, stage: { 3: 'Z0', 5: 'P1' } });
    expect(stageDefs(s, 0)).toEqual([[], ['P1'], [], [], []]);
    expect(stageDefs(s, 1)).toEqual([[], [], [], [], ['P1']]);
    expect(defsIn(s, 0, 'waiting')).toEqual(['Z0']);
    expect(defsIn(s, 1, 'waiting')).toEqual(['Z0']);
    const rules = eventsOf(s.log, 'ruleAction');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ rule: 'insufficientPower' });
    expect(sorted(rules[0]?.cards ?? [])).toEqual(sorted([...s.players[0].waiting, ...s.players[1].waiting]));
    // Removed at the check timing before the first play timing.
    expect(s.log.findIndex((e) => e.kind === 'ruleAction')).toBeGreaterThan(s.log.findIndex((e) => e.kind === 'checkTiming'));
    expect(s.log.findIndex((e) => e.kind === 'ruleAction')).toBeLessThan(s.log.findIndex((e) => e.kind === 'playTiming'));
  });

  it("[PWR-01][ILL-01] cards removed by these rule actions go to their owner's waiting room, even from the other player's stage or climax area", () => {
    const s = main({ hand: ['G0'], stage: { 4: 'Y0' } }, { deck: FILL, hand: ['Z0', 'YE0', 'G0'] });
    const zero = cardIn(s, 1, 'hand', 'Z0');
    const event = cardIn(s, 1, 'hand', 'YE0');
    const character = cardIn(s, 1, 'hand', 'G0');
    // Only card effects (M3) can put an opponent's card into these zones, so place them directly.
    const t = ops.deepClone(s);
    ops.moveCard(t, zero, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    ops.moveCard(t, event, { player: 0, zone: 'stage', slot: 2 }, 'effect');
    ops.moveCard(t, character, { player: 0, zone: 'climax' }, 'effect');

    const after = act(t, cat, { type: 'PASS', player: 0 }); // the climax phase opens with a check timing
    expect(sorted(after.players[1].waiting)).toEqual(sorted([zero, event, character]));
    expect(after.players[0].waiting).toEqual([]);
    expect(stageDefs(after, 0)).toEqual([[], [], [], ['Y0'], []]);
    expect(after.players[0].climax).toEqual([]);
    const removals = movesOf(since(t, after)).filter((e) => e.reason === 'ruleAction');
    expect(removals).toHaveLength(3);
    for (const e of removals) expect(e.to).toEqual({ player: 1, zone: 'waiting' });
  });

  it("[ILL-01] an event or a climax on a stage position goes to its owner's waiting room at the check timing; characters stay", () => {
    const s = main({ hand: ['G0'], stage: { 1: 'YE0', 2: 'YX', 3: 'Y0' } }, { deck: FILL, stage: { 5: 'RC0' } });
    expect(stageDefs(s, 0)).toEqual([[], [], ['Y0'], [], []]);
    expect(sorted(defsIn(s, 0, 'waiting'))).toEqual(['YE0', 'YX']);
    expect(stageDefs(s, 1)).toEqual([[], [], [], [], []]);
    expect(defsIn(s, 1, 'waiting')).toEqual(['RC0']);
    const rules = eventsOf(s.log, 'ruleAction');
    expect(rules.map((e) => e.rule)).toEqual(['illegalCard']);
    expect(sorted(rules[0]?.players.map(String) ?? [])).toEqual(['0', '1']);
  });

  it("[ILL-01] a character or an event in the climax area goes to its owner's waiting room; a climax there stays", () => {
    const s = main({ hand: ['G0'], climax: ['Y0'] }, { deck: FILL, climax: ['RE0'] });
    expect(climaxDefs(s, 0)).toEqual([]);
    expect(defsIn(s, 0, 'waiting')).toEqual(['Y0']);
    expect(climaxDefs(s, 1)).toEqual([]);
    expect(defsIn(s, 1, 'waiting')).toEqual(['RE0']);

    const legal = main({ hand: ['G0'], climax: ['YX'] });
    expect(climaxDefs(legal, 0)).toEqual(['YX']);
    expect(eventsOf(legal.log, 'ruleAction')).toEqual([]);
  });

  it('[ILL-01][ILL-02] an illegal card placed after a legal one does not push the legal one out: only the illegal card goes', () => {
    const s = main({ hand: ['G0'], stage: { 1: ['Y0', 'YE0'] }, climax: ['YX', 'R0'] });
    expect(stageDefs(s, 0)[0]).toEqual(['Y0']);
    expect(climaxDefs(s, 0)).toEqual(['YX']);
    expect(sorted(defsIn(s, 0, 'waiting'))).toEqual(['R0', 'YE0']);
    expect(eventsOf(s.log, 'ruleAction').map((e) => e.rule)).toEqual(['illegalCard']);
  });

  it('[ILL-02] when a stage position holds several characters only the one placed last stays; the others go to the waiting room', () => {
    const s = main({ hand: ['G0'], stage: { 1: ['Y0', 'R0'], 3: ['B0', 'G0', 'Y1'] } }, { deck: FILL, stage: { 5: ['R1', 'R0'] } });
    expect(stageDefs(s, 0)).toEqual([['R0'], [], ['Y1'], [], []]);
    expect(stageDefs(s, 1)).toEqual([[], [], [], [], ['R0']]);
    expect(sorted(defsIn(s, 0, 'waiting'))).toEqual(['B0', 'G0', 'Y0']);
    expect(defsIn(s, 1, 'waiting')).toEqual(['R1']);
    expect(eventsOf(s.log, 'ruleAction').map((e) => e.rule)).toEqual(['extraCards']);
  });

  it('[ILL-02] when the climax area holds several climaxes only the one placed last stays; a single climax is left alone', () => {
    const s = main({ hand: ['G0'], climax: ['RX', 'BX', 'YX'] }, { deck: FILL, climax: ['RX'] });
    expect(climaxDefs(s, 0)).toEqual(['YX']);
    expect(sorted(defsIn(s, 0, 'waiting'))).toEqual(['BX', 'RX']);
    expect(climaxDefs(s, 1)).toEqual(['RX']);
    expect(s.players[1].waiting).toEqual([]);
  });

  it('[ILL-02] if several cards tie as the most recently placed, all of them go, on a stage position or in the climax area', () => {
    const s = makeState(cat, {
      players: [
        { deck: FILL, hand: ['G0'], stage: { 1: ['Y0', 'R0'], 2: ['B0', 'G0', 'Y1'], 3: ['Y0b', 'R1'] }, climax: ['RX', 'YX'] },
        { deck: FILL, hand: ['G0'], climax: ['BX', 'RX', 'YX'] },
      ],
      start: 'mulligan',
    });
    expect(s.pending).toEqual({ kind: 'mulligan', player: 0 });
    // No action can place two cards at the same instant in M1, so give them the same placement stamp directly.
    const t = ops.deepClone(s);
    tieNewest(t.players[0].stage[0], 2); // Y0 and R0 tie
    tieNewest(t.players[0].stage[1], 2); // G0 and Y1 tie above the older B0
    tieNewest(t.players[0].climax, 2); // RX and YX tie
    tieNewest(t.players[1].climax, 2); // RX and YX tie above the older BX
    // Position 3 is the contrast: no tie, so R1 (placed last) stays.

    const after = act(t, cat, { type: 'MULLIGAN', player: 0, discard: [] }, { type: 'MULLIGAN', player: 1, discard: [] });
    expect(stageDefs(after, 0)).toEqual([[], [], ['R1'], [], []]);
    expect(climaxDefs(after, 0)).toEqual([]);
    expect(climaxDefs(after, 1)).toEqual([]);
    expect(sorted(defsIn(after, 0, 'waiting'))).toEqual(sorted(['Y0', 'R0', 'B0', 'G0', 'Y1', 'Y0b', 'RX', 'YX']));
    expect(sorted(defsIn(after, 1, 'waiting'))).toEqual(sorted(['BX', 'RX', 'YX']));
  });
});
