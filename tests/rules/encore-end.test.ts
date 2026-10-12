// Rule tests for M2: the Encore Step (CR 7.7), the Encore keyword and the
// default Encore every character has (CR 10.2), and the end of "until end of
// turn" / "during this turn" effects in the End Phase (CR 6.8.1.4). Encore is
// an automatic ability played in check timings (CR 8.5.1, 8.7).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentPower, currentSoul, ENCORE_COST, legalActions, locate, validate } from '../../src/engine';
import type { Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot, Task } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const extra: CardDef[] = [
  { id: 'SHX', name: 'Quiet Volley', kind: 'climax', color: 'yellow', triggers: ['shot'] },
  { id: 'RTX', name: 'Recall Breeze', kind: 'climax', color: 'yellow', triggers: ['return'] },
  { id: 'BKX', name: 'Steady Bulwark', kind: 'character', color: 'red', level: 0, cost: 0, power: 1000, soul: 1, backup: { power: 2000, level: 0, stock: 0 } },
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons: trigger checks do nothing and damage always sticks. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];
/** Eight cards in hand: one over the limit, so the End Phase stops at the discard (B0 is the one to drop). */
const OVER_LIMIT = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'B0'];
const THREE = ['B1', 'B1', 'B1'];

/** Starts at the Attack Phase; player 0 is the turn player unless `more` says otherwise. */
function attackPhase(p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start: 'attack', players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }], ...more });
}

/** Starts at the Main Phase (player 0's turn). */
function mainPhase(p0: ZoneSpec, p1: ZoneSpec = {}): GameState {
  return makeState(cat, { start: 'main', players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }] });
}

const rev = (def: string) => ({ def, orientation: 'reverse' as const });
const rested = (def: string) => ({ def, orientation: 'rest' as const });

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });

interface Step {
  state: GameState;
  events: GameEvent[];
}

/** Applies one action and throws with the engine's reason if it is refused. */
function go(s: GameState, action: Action): Step {
  const r = applyAction(s, cat, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** The error code validate gives, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const r = validate(s, cat, action);
  return r.ok ? 'ok' : r.error.code;
}

const defOf = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** The card on a stage position. */
function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const c = s.players[player].stage[slot - 1]?.[0];
  if (!c) throw new Error(`no card on player ${player}'s position ${slot}`);
  return c.id;
}

/** Where a card is: 'stage:<player>:<slot>:<orientation>' on the stage, '<zone>:<player>' elsewhere. */
function where(s: GameState, card: CardId): string {
  const loc = locate(s, card);
  if (!loc) return 'nowhere';
  if (loc.zone === 'stage') {
    const entry = s.players[loc.player].stage[(loc.slot ?? 1) - 1]?.[loc.index];
    return `stage:${loc.player}:${loc.slot ?? '?'}:${entry?.orientation ?? '?'}`;
  }
  return `${loc.zone}:${loc.player}`;
}

/** A copy in which an effect (simulated) has put this stage character into the Reverse State. */
function reversedCopy(s: GameState, card: CardId): GameState {
  const copy = ops.deepClone(s);
  const entry = copy.players.flatMap((p) => p.stage.flat()).find((c) => c.id === card);
  if (!entry) throw new Error(`${card} is not on the stage`);
  entry.orientation = 'reverse';
  return copy;
}

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'phase') return [`phase:${e.phase}`];
    if (e.kind === 'turnStart') return [`turnStart:${e.player}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'trigger') return [`trigger:${e.condition}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'played') return [`played:${defOf(s, e.card)}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.zone}->${e.to.zone}`];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'auto') return [`auto:${e.ability}:${defOf(s, e.card)}`];
    if (e.kind === 'effectsExpired') return ['effectsExpired'];
    return [];
  });
}

/** The trace up to and including the first `marker`. */
function upTo(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(0, i + 1);
}

/** Legal actions for the player being waited on, readable and sorted. */
function offers(s: GameState): string[] {
  return legalActions(s, cat)
    .map((a) => ('card' in a && typeof a.card === 'string' ? `${a.type}:${defOf(s, a.card)}` : a.type))
    .sort();
}

const movesOf = (events: readonly GameEvent[]) => events.filter((e): e is Extract<GameEvent, { kind: 'move' }> => e.kind === 'move');

// =============================================================================
// ENC-01: the turn player's reversed characters (CR 7.7.1.1-7.7.1.2)
// =============================================================================

describe('ENC-01: the turn player clears their reversed characters one at a time', () => {
  it('[ENC-01] the step opens with its trigger condition and a check timing; then the turn player picks one reversed character at a time', () => {
    // Y0 stands, Y2 is rested, Y1 (center) and Y3 (back stage) are reversed.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: rev('Y1'), 3: rested('Y2'), 4: rev('Y3') } }, { stage: { 2: 'R1' } });
    expect(s0.pending).toEqual({ kind: 'attack', player: 0 });
    const [y0, y1, y2, y3] = [idAt(s0, 0, 1), idAt(s0, 0, 2), idAt(s0, 0, 3), idAt(s0, 0, 4)];

    // Ending the Attack Phase: the encore step's trigger and its check timing come before anything leaves.
    const a = go(s0, pass(0));
    expect(trace(a.state, a.events)).toEqual(['action:PASS:0', 'step:encore', 'trigger:encoreStepStart', 'check']);
    expect(a.state.step).toBe('encore');
    expect(a.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'encoreStep', options: [y1, y3], optional: false });
    expect(where(a.state, y1)).toBe('stage:0:2:reverse');
    expect(where(a.state, y3)).toBe('stage:0:4:reverse');

    // The choice is mandatory, is the turn player's, and covers only Reverse State characters.
    expect(offers(a.state)).toEqual(['CHOOSE_CARD:Y1', 'CHOOSE_CARD:Y3']);
    expect(attempt(a.state, pass(0))).toBe('ILLEGAL_ACTION');
    expect(attempt(a.state, choose(0, y0))).toBe('ILLEGAL_ACTION');
    expect(attempt(a.state, choose(0, y2))).toBe('ILLEGAL_ACTION');
    expect(legalActions(a.state, cat, 1)).toEqual([]);

    // Picking the back-stage one first: it goes, a check timing, then the other, another check timing.
    const b = go(a.state, choose(0, y3));
    expect(upTo(trace(b.state, b.events), 'phase:end')).toEqual([
      'action:CHOOSE_CARD:0',
      'move:encoreStep:Y3:stage->waiting',
      'check',
      'move:encoreStep:Y1:stage->waiting',
      'check',
      'check',
      'phase:end',
    ]);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['Y3', 'Y1']);
    // Standing and rested characters are not touched.
    expect(where(b.state, y0)).toBe('stage:0:1:stand');
    expect(where(b.state, y2)).toBe('stage:0:3:rest');
  });

  it('[ENC-01] the check timing after each removal is fully resolved first: the first character\'s Encore is settled before the next one leaves', () => {
    // Six stock (bottom -> top): enough for two Encores.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: rev('Y1'), 4: rev('Y3') }, stock: ['B1', 'B1', 'B1', 'B0', 'B0', 'B0'] });
    const [y1, y3] = [idAt(s0, 0, 2), idAt(s0, 0, 4)];
    const a = go(go(s0, pass(0)).state, choose(0, y1));
    expect(trace(a.state, a.events)).toEqual(['action:CHOOSE_CARD:0', 'move:encoreStep:Y1:stage->waiting', 'check']);
    // Inside that check timing the Encore waits for an answer; Y3 has not moved yet.
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 2, cost: 3 });
    expect(where(a.state, y3)).toBe('stage:0:4:reverse');
    expect(a.state.step).toBe('encore');

    // Paying brings Y1 back rested. Only after that check timing does Y3 go, followed by its own check timing.
    const b = go(a.state, accept(0));
    expect(trace(b.state, b.events)).toEqual([
      'action:ACCEPT:0',
      'move:cost:B0:stock->waiting',
      'move:cost:B0:stock->waiting',
      'move:cost:B0:stock->waiting',
      'auto:encore:Y1',
      'move:encore:Y1:waiting->stage',
      'move:encoreStep:Y3:stage->waiting',
      'check',
    ]);
    expect(b.state.pending).toEqual({ kind: 'encore', player: 0, card: y3, slot: 4, cost: 3 });
    // Y1 is back in the Rest State, so it is not taken again.
    expect(where(b.state, y1)).toBe('stage:0:2:rest');

    const c = go(b.state, accept(0));
    expect(upTo(trace(c.state, c.events), 'phase:end')).toEqual([
      'action:ACCEPT:0',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'auto:encore:Y3',
      'move:encore:Y3:waiting->stage',
      'check',
      'phase:end',
    ]);
    expect(where(c.state, y1)).toBe('stage:0:2:rest');
    expect(where(c.state, y3)).toBe('stage:0:4:rest');
    expect(c.state.players[0].stock).toEqual([]);
  });

  it("[ENC-01] a reversed character goes to its owner's waiting room: one on the turn player's stage that the opponent owns goes to the opponent's", () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 4: rev('Y1') } }, { hand: ['R1'] });
    const y1 = idAt(s0, 0, 4);
    // An effect (simulated) has put player 1's R1 on player 0's position 2, reversed.
    const s1 = ops.deepClone(s0);
    const r1 = cardIn(s1, 1, 'hand', 'R1');
    ops.moveCard(s1, r1, { player: 0, zone: 'stage', slot: 2 }, 'effect', { orientation: 'reverse' });

    // It is on the turn player's stage, so the turn player chooses it, in their own part of the step.
    const a = go(s1, pass(0));
    expect(a.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'encoreStep', options: [r1, y1], optional: false });
    const b = go(a.state, choose(0, r1));
    expect(upTo(trace(b.state, b.events), 'phase:end')).toEqual([
      'action:CHOOSE_CARD:0',
      'move:encoreStep:R1:stage->waiting',
      'check',
      'move:encoreStep:Y1:stage->waiting',
      'check',
      'check',
      'phase:end',
    ]);
    const leave = movesOf(b.events).filter((m) => m.reason === 'encoreStep');
    expect(leave.map((m) => [defOf(b.state, m.card), m.from, m.to])).toEqual([
      ['R1', { player: 0, zone: 'stage', slot: 2 }, { player: 1, zone: 'waiting' }],
      ['Y1', { player: 0, zone: 'stage', slot: 4 }, { player: 0, zone: 'waiting' }],
    ]);
    expect(defsIn(b.state, 1, 'waiting')).toEqual(['R1']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['Y1']);
  });
});

// =============================================================================
// ENC-02: then the non-turn player, going back to the turn player after each (CR 7.7.1.3)
// =============================================================================

describe("ENC-02: the non-turn player's reversed characters", () => {
  it("[ENC-02] the non-turn player's reversed characters go only once the turn player has none left, and the non-turn player picks the order", () => {
    // Player 0's Y0 faces player 1's B0, so attacking is still possible and the phase waits for PASS.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: rev('Y1'), 5: rev('Y2') } }, { stage: { 1: rev('R0'), 2: rev('R1'), 3: 'B0' } });
    const [y1, y2] = [idAt(s0, 0, 2), idAt(s0, 0, 5)];
    const [r0, r1, b0] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];

    const a = go(s0, pass(0));
    expect(a.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'encoreStep', options: [y1, y2], optional: false });
    expect(where(a.state, r0)).toBe('stage:1:1:reverse');

    const b = go(a.state, choose(0, y2));
    expect(trace(b.state, b.events)).toEqual([
      'action:CHOOSE_CARD:0',
      'move:encoreStep:Y2:stage->waiting',
      'check',
      'move:encoreStep:Y1:stage->waiting',
      'check',
    ]);
    // Now it is the non-turn player's choice, and only theirs.
    expect(b.state.pending).toEqual({ kind: 'choose', player: 1, reason: 'encoreStep', options: [r0, r1], optional: false });
    expect(offers(b.state)).toEqual(['CHOOSE_CARD:R0', 'CHOOSE_CARD:R1']);
    expect(legalActions(b.state, cat, 0)).toEqual([]);
    expect(attempt(b.state, pass(1))).toBe('ILLEGAL_ACTION');
    expect(attempt(b.state, choose(1, b0))).toBe('ILLEGAL_ACTION');

    const c = go(b.state, choose(1, r1));
    expect(upTo(trace(c.state, c.events), 'phase:end')).toEqual([
      'action:CHOOSE_CARD:1',
      'move:encoreStep:R1:stage->waiting',
      'check',
      'move:encoreStep:R0:stage->waiting',
      'check',
      'check',
      'phase:end',
    ]);
    expect(movesOf(c.events).filter((m) => m.reason === 'encoreStep').map((m) => m.to)).toEqual([
      { player: 1, zone: 'waiting' },
      { player: 1, zone: 'waiting' },
    ]);
    expect(defsIn(c.state, 1, 'waiting')).toEqual(['R1', 'R0']);
    expect(defsIn(c.state, 0, 'waiting')).toEqual(['Y2', 'Y1']);
  });

  it("[ENC-02] the turn player's Encore decision is settled before any of the non-turn player's characters leave", () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: rev('Y1') }, stock: THREE }, { stage: { 2: rev('R1') }, stock: ['G0', 'G0', 'G0'] });
    const [y1, r1] = [idAt(s0, 0, 2), idAt(s0, 1, 2)];

    const a = go(s0, pass(0));
    expect(trace(a.state, a.events)).toEqual([
      'action:PASS:0',
      'step:encore',
      'trigger:encoreStepStart',
      'check',
      'move:encoreStep:Y1:stage->waiting',
      'check',
    ]);
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 2, cost: 3 });
    expect(where(a.state, r1)).toBe('stage:1:2:reverse');

    const b = go(a.state, pass(0));
    expect(trace(b.state, b.events)).toEqual(['action:PASS:0', 'move:encoreStep:R1:stage->waiting', 'check']);
    expect(b.state.pending).toEqual({ kind: 'encore', player: 1, card: r1, slot: 2, cost: 3 });

    const c = go(b.state, pass(1));
    expect(upTo(trace(c.state, c.events), 'phase:end')).toEqual(['action:PASS:1', 'check', 'phase:end']);
  });

  it("[ENC-02] after each of the non-turn player's removals the step goes back to the turn player: a turn-player character reversed meanwhile goes first", () => {
    // Player 0 holds eight cards, so the End Phase stops at the discard and the stage can be inspected.
    const s0 = attackPhase({ stage: { 1: 'Y0' }, hand: OVER_LIMIT }, { stage: { 1: rev('R0'), 2: rev('R1') }, stock: THREE });
    const [y0, r0, r1] = [idAt(s0, 0, 1), idAt(s0, 1, 1), idAt(s0, 1, 2)];

    // The turn player has nothing reversed, so the non-turn player starts.
    const a = go(s0, pass(0));
    expect(trace(a.state, a.events)).toEqual(['action:PASS:0', 'step:encore', 'trigger:encoreStepStart', 'check']);
    expect(a.state.pending).toEqual({ kind: 'choose', player: 1, reason: 'encoreStep', options: [r0, r1], optional: false });

    // R0 leaves; in the check timing after it, R0's Encore waits for player 1.
    const b = go(a.state, choose(1, r0));
    expect(b.state.pending).toEqual({ kind: 'encore', player: 1, card: r0, slot: 1, cost: 3 });

    // Meanwhile an effect (simulated) puts the turn player's Y0 into the Reverse State.
    const meanwhile = reversedCopy(b.state, y0);
    const c = go(meanwhile, accept(1));
    expect(upTo(trace(c.state, c.events), 'phase:end')).toEqual([
      'action:ACCEPT:1',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'auto:encore:R0',
      'move:encore:R0:waiting->stage',
      // Back to the turn player first: Y0 goes before R1, which was reversed all along.
      'move:encoreStep:Y0:stage->waiting',
      'check',
      'move:encoreStep:R1:stage->waiting',
      'check',
      'check',
      'phase:end',
    ]);
    expect(c.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(where(c.state, r0)).toBe('stage:1:1:rest');
    expect(where(c.state, y0)).toBe('waiting:0');
    expect(where(c.state, r1)).toBe('waiting:1');
  });

  it("[ENC-02] it follows the turn, not the seat: on player 1's turn player 1's reversed characters go first, then player 0's", () => {
    // Player 1 is the turn player; their B0 on position 3 faces player 0's empty position 1, so it could attack.
    const s0 = attackPhase({ stage: { 2: rev('Y1'), 4: rev('Y2') } }, { stage: { 2: rev('R1'), 3: 'B0' } }, { active: 1 });
    expect(s0.pending).toEqual({ kind: 'attack', player: 1 });
    const [y1, y2] = [idAt(s0, 0, 2), idAt(s0, 0, 4)];

    const a = go(s0, pass(1));
    // R1, player 1's only reversed character, goes first without a choice; then player 0 chooses between theirs.
    expect(trace(a.state, a.events)).toEqual([
      'action:PASS:1',
      'step:encore',
      'trigger:encoreStepStart',
      'check',
      'move:encoreStep:R1:stage->waiting',
      'check',
    ]);
    expect(a.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'encoreStep', options: [y1, y2], optional: false });
    expect(legalActions(a.state, cat, 1)).toEqual([]);

    const b = go(a.state, choose(0, y1));
    expect(upTo(trace(b.state, b.events), 'phase:end')).toEqual([
      'action:CHOOSE_CARD:0',
      'move:encoreStep:Y1:stage->waiting',
      'check',
      'move:encoreStep:Y2:stage->waiting',
      'check',
      'check',
      'phase:end',
    ]);
  });
});

// =============================================================================
// ENC-03: the closing check timing (CR 7.7.1.4)
// =============================================================================

describe('ENC-03: the closing check timing and the way out of the Encore Step', () => {
  it('[ENC-03] with nothing reversed the step is its trigger, the opening check timing and the closing one, then the End Phase', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 3: rested('Y1') } }, { stage: { 2: rested('R1') } });
    const r = go(s0, pass(0));
    expect(upTo(trace(r.state, r.events), 'phase:end')).toEqual([
      'action:PASS:0',
      'step:encore',
      'trigger:encoreStepStart',
      'check',
      'check',
      'phase:end',
    ]);
    expect(movesOf(r.events).filter((m) => m.reason === 'encoreStep')).toEqual([]);
    expect(where(r.state, idAt(s0, 0, 3))).toBe('stage:0:3:rest');
  });

  it('[ENC-03] after the last removal and its check timing, one more check timing runs; the End Phase waits until both are done', () => {
    // Player 1 can pay for one Encore. Player 0 holds eight cards, so the End Phase stops at the discard.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: rev('Y1') }, hand: OVER_LIMIT }, { stage: { 2: rev('R1') }, stock: THREE });
    const r1 = idAt(s0, 1, 2);

    const a = go(s0, pass(0));
    expect(trace(a.state, a.events)).toEqual([
      'action:PASS:0',
      'step:encore',
      'trigger:encoreStepStart',
      'check',
      'move:encoreStep:Y1:stage->waiting',
      'check',
      'move:encoreStep:R1:stage->waiting',
      'check',
    ]);
    // The last removal's check timing is still open (R1's Encore): no End Phase yet.
    expect(a.state.pending).toEqual({ kind: 'encore', player: 1, card: r1, slot: 2, cost: 3 });
    expect(a.state.phase).toBe('attack');
    expect(a.state.step).toBe('encore');

    // R1 comes back rested, not reversed, so after the closing check timing the step is over.
    const b = go(a.state, accept(1));
    expect(upTo(trace(b.state, b.events), 'phase:end')).toEqual([
      'action:ACCEPT:1',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'auto:encore:R1',
      'move:encore:R1:waiting->stage',
      'check',
      'phase:end',
    ]);
    expect(b.state.phase).toBe('end');
    expect(b.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(where(b.state, r1)).toBe('stage:1:2:rest');
    const reversedLeft = b.state.players.flatMap((p) => p.stage.flat()).filter((c) => c.orientation === 'reverse');
    expect(reversedLeft).toEqual([]);
  });

  it('[ENC-03] a character in the Reverse State after the closing check timing sends the step back to the removals instead of the End Phase', () => {
    // No M2 card can reverse a character inside that check timing, so the engine is started right at
    // CR 7.7.1.4 (its check timing, then the decision) with and without a reversed character.
    const s0 = attackPhase({ stage: { 1: 'Y0' } }, { stage: { 2: 'R1' } });
    const [y0, r1] = [idAt(s0, 0, 1), idAt(s0, 1, 2)];
    const closing = (reversed: CardId | null): string[] => {
      const s = reversed === null ? ops.deepClone(s0) : reversedCopy(s0, reversed);
      s.pending = null;
      s.step = 'encore';
      const tasks: Task[] = [{ t: 'check' }, { t: 'encoreEnd' }];
      s.tasks = tasks;
      const before = s.log.length;
      ops.run(s, cat);
      return upTo(trace(s, s.log.slice(before)), 'phase:end');
    };
    expect(closing(null)).toEqual(['check', 'phase:end']);
    // Either player's stage counts: the non-turn player's R1 ...
    expect(closing(r1)).toEqual(['check', 'move:encoreStep:R1:stage->waiting', 'check', 'check', 'phase:end']);
    // ... and the turn player's Y0.
    expect(closing(y0)).toEqual(['check', 'move:encoreStep:Y0:stage->waiting', 'check', 'check', 'phase:end']);
  });
});

// =============================================================================
// KW-02: Encore [cost] (CR 10.2.1-10.2.2)
// =============================================================================

describe('KW-02: Encore [cost]', () => {
  it('[KW-02] not only reversed characters: one pushed off its position by a newer character may pay to come back to that position, rested', () => {
    const s0 = mainPhase({ stage: { 1: 'Y1' }, hand: ['Y0'], stock: ['G0', 'B1', 'B1', 'B1'] });
    const y1 = idAt(s0, 0, 1);
    // Moved to position 4 first, so "the position it was in" is 4, standing.
    const s1 = go(s0, { type: 'SWAP', player: 0, a: 1, b: 4 }).state;
    expect(where(s1, y1)).toBe('stage:0:4:stand');
    const y0 = cardIn(s1, 0, 'hand', 'Y0');

    const a = go(s1, { type: 'PLAY_CHARACTER', player: 0, card: y0, slot: 4 });
    expect(trace(a.state, a.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:Y0',
      'move:play:Y0:hand->stage',
      'check',
      'rule:extraCards:Y1',
      'move:ruleAction:Y1:stage->waiting',
    ]);
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 4, cost: 3 });
    expect(offers(a.state)).toEqual(['ACCEPT', 'PASS']);

    // Pay first, then the card goes back to position 4 in the Rest State (it was standing before).
    const b = go(a.state, accept(0));
    expect(trace(b.state, b.events)).toEqual([
      'action:ACCEPT:0',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'auto:encore:Y1',
      'move:encore:Y1:waiting->stage',
      // Now Y0 is the older card there and leaves; one stock is not enough for its Encore.
      'rule:extraCards:Y0',
      'move:ruleAction:Y0:stage->waiting',
      'playTiming:0:main',
    ]);
    const back = movesOf(b.events).find((m) => m.reason === 'encore');
    expect(back?.to).toEqual({ player: 0, zone: 'stage', slot: 4 });
    expect(where(b.state, y1)).toBe('stage:0:4:rest');
    expect(where(b.state, y0)).toBe('waiting:0');
    expect(defsIn(b.state, 0, 'stock')).toEqual(['G0']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['B1', 'B1', 'B1', 'Y0']);
    // A new object: it no longer counts as the card that was on the stage before.
    expect(b.state.cards[y1]?.epoch).toBe((s1.cards[y1]?.epoch ?? 0) + 2);
  });

  it('[KW-02] paying is optional: declining leaves the card in the waiting room and the stock alone, and the ability is used up', () => {
    const s0 = mainPhase({ stage: { 2: 'Y1' }, hand: ['Y0'], stock: THREE });
    const y1 = idAt(s0, 0, 2);
    const y0 = cardIn(s0, 0, 'hand', 'Y0');
    const a = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: y0, slot: 2 });
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 2, cost: 3 });

    const b = go(a.state, pass(0));
    expect(trace(b.state, b.events)).toEqual(['action:PASS:0', 'playTiming:0:main']);
    expect(where(b.state, y1)).toBe('waiting:0');
    expect(where(b.state, y0)).toBe('stage:0:2:stand');
    expect(defsIn(b.state, 0, 'stock')).toEqual(THREE);

    // Later check timings (the next play timing's, the Climax Phase's) do not offer it again.
    const c = go(b.state, pass(0));
    expect(c.state.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    expect(trace(c.state, c.state.log).filter((x) => x.startsWith('auto:'))).toEqual([]);
    expect(where(c.state, y1)).toBe('waiting:0');
  });

  it("[KW-02] the master decides: the non-turn player's character is offered to the non-turn player and paid from their stock", () => {
    // Player 0 holds eight cards, so the End Phase stops at the discard and the stage can be inspected.
    const s0 = attackPhase({ stage: { 1: 'Y0' }, stock: ['G0', 'G0', 'G0'], hand: OVER_LIMIT }, { stage: { 2: rev('R1') }, stock: THREE });
    const r1 = idAt(s0, 1, 2);
    const a = go(s0, pass(0));
    expect(a.state.pending).toEqual({ kind: 'encore', player: 1, card: r1, slot: 2, cost: 3 });
    expect(legalActions(a.state, cat, 0)).toEqual([]);
    expect(offers(a.state)).toEqual(['ACCEPT', 'PASS']);
    expect(attempt(a.state, accept(0))).toBe('NOT_YOUR_DECISION');

    const b = go(a.state, accept(1));
    expect(defsIn(b.state, 1, 'stock')).toEqual([]);
    expect(defsIn(b.state, 1, 'waiting')).toEqual(THREE);
    expect(defsIn(b.state, 0, 'stock')).toEqual(['G0', 'G0', 'G0']);
    expect(movesOf(b.events).find((m) => m.reason === 'encore')?.to).toEqual({ player: 1, zone: 'stage', slot: 2 });
    expect(b.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(where(b.state, r1)).toBe('stage:1:2:rest');
  });

  it('[KW-02] leaving the stage for somewhere other than the waiting room does not trigger it', () => {
    // A return icon sends player 1's R1 to hand; player 1 has the stock for an Encore, but none is offered.
    const s0 = attackPhase({ deck: [...PLAIN, 'RTX'], stage: { 2: 'Y1' } }, { stage: { 2: 'R1' }, stock: THREE });
    const r1 = idAt(s0, 1, 2);
    const a = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' });
    expect(a.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'return', options: [r1], optional: true });
    const b = go(a.state, choose(0, r1));
    expect(where(b.state, r1)).toBe('hand:1');
    expect(b.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(trace(b.state, b.events).filter((x) => x.startsWith('auto:'))).toEqual([]);
    expect(defsIn(b.state, 1, 'stock')).toEqual(THREE);

    // Seen from inside a check timing: an effect (simulated) moves player 1's R1 from the stage to the hand,
    // then player 0 pushes their own Y1 off position 2. While Y1's Encore waits for player 0, no Encore for R1
    // is waiting for player 1: going to the hand never put one into the standby condition.
    const m0 = mainPhase({ stage: { 2: 'Y1' }, hand: ['Y0'], stock: THREE }, { stage: { 2: 'R1' }, stock: THREE });
    const [my1, mr1] = [idAt(m0, 0, 2), idAt(m0, 1, 2)];
    const m1 = ops.deepClone(m0);
    ops.moveCard(m1, mr1, { player: 1, zone: 'hand' }, 'effect');
    const c = go(m1, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(m1, 0, 'hand', 'Y0'), slot: 2 });
    expect(c.state.pending).toEqual({ kind: 'encore', player: 0, card: my1, slot: 2, cost: 3 });
    expect(c.state.standby).toEqual([]);
    const d = go(c.state, pass(0));
    expect(d.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(where(d.state, mr1)).toBe('hand:1');
    expect(defsIn(d.state, 1, 'stock')).toEqual(THREE);
  });

  it('[KW-02] a card that has left the waiting room before its Encore resolves is not brought back', () => {
    // Y1 and Y2 each share a position with a newer character, so the first check timing removes both at once.
    const s0 = mainPhase({ stage: { 1: ['Y1', 'Y0'], 2: ['Y2', 'B0'] }, stock: THREE });
    const [y1, y2] = [cardIn(s0, 0, 'waiting', 'Y1'), cardIn(s0, 0, 'waiting', 'Y2')];
    expect(s0.pending?.kind).toBe('autoOrder');
    if (s0.pending?.kind !== 'autoOrder') throw new Error('expected two Encores to order');
    const forCard = (card: CardId): number => {
      const o = s0.pending?.kind === 'autoOrder' ? s0.pending.options.find((x) => x.ability === 'encore' && x.card.card === card) : undefined;
      if (!o) throw new Error(`no Encore for ${card}`);
      return o.id;
    };
    expect(s0.pending.options.map((o) => (o.ability === 'encore' ? [o.card.card, o.slot, o.cost] : []))).toEqual([
      [y1, 1, 3],
      [y2, 2, 3],
    ]);

    const a = go(s0, { type: 'ORDER_AUTO', player: 0, auto: forCard(y1) });
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 1, cost: 3 });
    // While Y2's Encore waits, an effect (simulated) moves Y2 from the waiting room to the hand.
    const s1 = ops.deepClone(a.state);
    ops.moveCard(s1, y2, { player: 0, zone: 'hand' }, 'effect');

    // Declining Y1 keeps the 3 stock, so only the card's absence can stop Y2's return.
    let b = go(s1, pass(0));
    const events = [...b.events];
    if (b.state.pending?.kind === 'encore' && b.state.pending.card === y2) {
      b = go(b.state, accept(0));
      events.push(...b.events);
    }
    expect(where(b.state, y2)).toBe('hand:0');
    expect(defsIn(b.state, 0, 'hand')).toEqual(['Y2']);
    expect(b.state.players[0].stage[1]?.map((c) => defOf(b.state, c.id))).toEqual(['B0']);
    expect(movesOf(events).filter((m) => m.reason === 'encore')).toEqual([]);
  });

  it('[KW-02] a card that left the waiting room and came back is a new card: the earlier Encore does not return it', () => {
    const s0 = mainPhase({ stage: { 1: ['Y1', 'Y0'], 2: ['Y2', 'B0'] }, stock: THREE });
    const [y1, y2] = [cardIn(s0, 0, 'waiting', 'Y1'), cardIn(s0, 0, 'waiting', 'Y2')];
    if (s0.pending?.kind !== 'autoOrder') throw new Error('expected two Encores to order');
    const forY1 = s0.pending.options.find((x) => x.ability === 'encore' && x.card.card === y1);
    if (!forY1) throw new Error('no Encore for Y1');

    const a = go(s0, { type: 'ORDER_AUTO', player: 0, auto: forY1.id });
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 1, cost: 3 });
    // While Y2's Encore waits, an effect (simulated) takes Y2 out of the waiting room and puts it back.
    const s1 = ops.deepClone(a.state);
    ops.moveCard(s1, y2, { player: 0, zone: 'hand' }, 'effect');
    ops.moveCard(s1, y2, { player: 0, zone: 'waiting' }, 'effect');
    expect(where(s1, y2)).toBe('waiting:0');

    // Declining Y1 keeps the 3 stock, so only Y2 being a new card can stop its return.
    let b = go(s1, pass(0));
    const events = [...b.events];
    if (b.state.pending?.kind === 'encore' && b.state.pending.card === y2) {
      b = go(b.state, accept(0));
      events.push(...b.events);
    }
    expect(where(b.state, y2)).toBe('waiting:0');
    expect(b.state.players[0].stage[1]?.map((c) => defOf(b.state, c.id))).toEqual(['B0']);
    expect(movesOf(events).filter((m) => m.reason === 'encore')).toEqual([]);
  });

  it('[KW-02] paying for Encore does not pull the card back from anywhere but the waiting room', () => {
    const s0 = mainPhase({ stage: { 2: 'Y1' }, hand: ['Y0'], stock: THREE });
    const y1 = idAt(s0, 0, 2);
    const a = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s0, 0, 'hand', 'Y0'), slot: 2 });
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 2, cost: 3 });
    // An effect (simulated) moves Y1 from the waiting room to the hand before the Encore resolves.
    const s1 = ops.deepClone(a.state);
    ops.moveCard(s1, y1, { player: 0, zone: 'hand' }, 'effect');

    const b = go(s1, accept(0));
    expect(where(b.state, y1)).toBe('hand:0');
    expect(b.state.players[0].stage[1]?.map((c) => defOf(b.state, c.id))).toEqual(['Y0']);
    expect(movesOf(b.events).filter((m) => m.reason === 'encore')).toEqual([]);
  });
});

// =============================================================================
// KW-03: every character has Encore [3] (CR 10.2.3)
// =============================================================================

describe('KW-03: the default Encore [3]', () => {
  it('[KW-03] every character has it, whatever its level, color or side, and it costs exactly 3 stock from the top', () => {
    expect(ENCORE_COST).toBe(3);
    const s0 = attackPhase(
      { stage: { 1: 'Y0', 2: rev('Y3') }, stock: ['G0', 'R0', 'Y1', 'Y2', 'B1'], hand: OVER_LIMIT },
      { stage: { 1: rev('R0'), 3: rev('B1') }, stock: ['G0', 'G0', 'G0'] },
    );
    const y3 = idAt(s0, 0, 2);
    const [r0, b1] = [idAt(s0, 1, 1), idAt(s0, 1, 3)];

    // Level 3 yellow, player 0.
    const a = go(s0, pass(0));
    expect(a.state.pending).toEqual({ kind: 'encore', player: 0, card: y3, slot: 2, cost: 3 });
    const b = go(a.state, accept(0));
    // Exactly three, taken from the top of the stock (the last entries): B1, then Y2, then Y1.
    expect(trace(b.state, b.events).slice(0, 5)).toEqual([
      'action:ACCEPT:0',
      'move:cost:B1:stock->waiting',
      'move:cost:Y2:stock->waiting',
      'move:cost:Y1:stock->waiting',
      'auto:encore:Y3',
    ]);
    expect(defsIn(b.state, 0, 'stock')).toEqual(['G0', 'R0']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['B1', 'Y2', 'Y1']);

    // Level 0 red and level 1 blue, player 1.
    expect(b.state.pending).toEqual({ kind: 'choose', player: 1, reason: 'encoreStep', options: [r0, b1], optional: false });
    const c = go(b.state, choose(1, r0));
    expect(c.state.pending).toEqual({ kind: 'encore', player: 1, card: r0, slot: 1, cost: 3 });
    const d = go(c.state, pass(1));
    expect(d.state.pending).toEqual({ kind: 'encore', player: 1, card: b1, slot: 3, cost: 3 });
    const e = go(d.state, accept(1));
    expect(defsIn(e.state, 1, 'stock')).toEqual([]);
    expect(where(e.state, y3)).toBe('stage:0:2:rest');
    expect(where(e.state, r0)).toBe('waiting:1');
    expect(where(e.state, b1)).toBe('stage:1:3:rest');
    expect(e.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
  });

  it('[KW-03] three stock is the line: with two it cannot be paid and the card stays in the waiting room; with three it is offered', () => {
    const run = (stock: string[]): Step => go(attackPhase({ stage: { 1: 'Y0', 2: rev('Y1') }, stock }), pass(0));

    const two = run(['B1', 'B1']);
    const y1 = cardIn(two.state, 0, 'waiting', 'Y1');
    expect(two.state.pending?.kind).not.toBe('encore');
    expect(trace(two.state, two.events).filter((x) => x.startsWith('auto:') || x.startsWith('move:encore:'))).toEqual([]);
    expect(where(two.state, y1)).toBe('waiting:0');
    expect(defsIn(two.state, 0, 'stock')).toEqual(['B1', 'B1']);
    // The step went on to the End Phase without it.
    expect(upTo(trace(two.state, two.events), 'phase:end').slice(-4)).toEqual(['move:encoreStep:Y1:stage->waiting', 'check', 'check', 'phase:end']);

    const three = run(THREE);
    expect(three.state.pending).toEqual({ kind: 'encore', player: 0, card: cardIn(three.state, 0, 'waiting', 'Y1'), slot: 2, cost: 3 });
  });

  it('[KW-03] only characters have it: an event or climax removed from the stage brings no Encore, the character removed with them does', () => {
    // An event on position 4 and a climax on position 5 are illegal there; Y1 shares position 1 with a newer Y0.
    const s0 = mainPhase({ stage: { 1: ['Y1', 'Y0'], 4: 'YE0', 5: 'YX' }, stock: THREE });
    const y1 = cardIn(s0, 0, 'waiting', 'Y1');
    const t = trace(s0, s0.log);
    expect(t).toContain('rule:illegalCard:YE0,YX');
    expect(t).toContain('rule:extraCards:Y1');
    // One Encore only, for Y1: no order to choose, nothing for the event or the climax.
    expect(s0.pending).toEqual({ kind: 'encore', player: 0, card: y1, slot: 1, cost: 3 });

    const a = go(s0, pass(0));
    expect(a.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(defsIn(a.state, 0, 'waiting')).toEqual(expect.arrayContaining(['YE0', 'YX', 'Y1']));
    expect(defsIn(a.state, 0, 'stock')).toEqual(THREE);
  });
});

// =============================================================================
// END-04: "until end of turn" and "during this turn" end after the End Phase check timing (CR 6.8.1.4)
// =============================================================================

describe('END-04: end of turn effects', () => {
  it('[END-04] attack and trigger soul bonuses last through the Encore Step, the discard and the climax cleanup, and end right after the following check timing', () => {
    // A direct attack (+1 soul) whose trigger check reveals a soul icon (+1 soul). A climax sits in the climax area.
    const s0 = attackPhase({ deck: [...PLAIN, 'YX'], stage: { 2: 'Y1' }, hand: OVER_LIMIT, climax: ['BX'] });
    const y1 = idAt(s0, 0, 2);
    const a = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'direct' });
    const ta = trace(a.state, a.events);
    // Y1 cannot attack again, so the Attack Phase ends by itself and the End Phase stops at the discard.
    expect(ta).toContain('step:encore');
    expect(ta).toContain('phase:end');
    expect(ta).not.toContain('effectsExpired');
    expect(a.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(currentSoul(a.state, cat, y1)).toBe(3);
    expect(a.state.effects.map((e) => [e.card.card, e.stat, e.amount])).toEqual([
      [y1, 'soul', 1],
      [y1, 'soul', 1],
    ]);

    const b = go(a.state, { type: 'DISCARD', player: 0, cards: [cardIn(a.state, 0, 'hand', 'B0')] });
    expect(upTo(trace(b.state, b.events), 'turnStart:1')).toEqual([
      'action:DISCARD:0',
      'move:handLimit:B0:hand->waiting',
      'move:climaxCleanup:BX:climax->waiting',
      'check',
      'effectsExpired',
      'turnStart:1',
    ]);
    expect(b.state.effects).toEqual([]);
    expect(currentSoul(b.state, cat, y1)).toBe(1);
  });

  it('[END-04] they still apply while that check timing is being resolved, and end only once it is done', () => {
    // Stock 2 + the trigger card = 3, enough for one Encore. Y0 stands on position 4.
    const s0 = attackPhase({ deck: [...PLAIN, 'YX'], stage: { 2: 'Y1', 4: 'Y0' }, hand: OVER_LIMIT, climax: ['BX'], stock: ['B1', 'B1'] });
    const [y1, y0] = [idAt(s0, 0, 2), idAt(s0, 0, 4)];
    const a = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'direct' });
    expect(a.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });

    // An effect (simulated) puts another character on position 4, so the next check timing has work to do.
    const s1 = ops.deepClone(a.state);
    ops.moveCard(s1, cardIn(s1, 0, 'hand', 'G0'), { player: 0, zone: 'stage', slot: 4 }, 'effect');
    const b = go(s1, { type: 'DISCARD', player: 0, cards: [cardIn(s1, 0, 'hand', 'B0')] });
    expect(trace(b.state, b.events)).toEqual([
      'action:DISCARD:0',
      'move:handLimit:B0:hand->waiting',
      'move:climaxCleanup:BX:climax->waiting',
      'check',
      'rule:extraCards:Y0',
      'move:ruleAction:Y0:stage->waiting',
    ]);
    // Mid check timing (Y0's Encore is waiting): the bonuses are still there.
    expect(b.state.pending).toEqual({ kind: 'encore', player: 0, card: y0, slot: 4, cost: 3 });
    expect(b.state.phase).toBe('end');
    expect(currentSoul(b.state, cat, y1)).toBe(3);
    expect(b.state.effects).toHaveLength(2);

    // Once the check timing is over they end, before the End Phase starts over (it had work to do).
    const c = go(b.state, pass(0));
    expect(upTo(trace(c.state, c.events), 'turnStart:1')).toEqual([
      'action:PASS:0',
      'effectsExpired',
      'phase:end',
      'trigger:turnEnd',
      'check',
      'check',
      'turnStart:1',
    ]);
    expect(currentSoul(c.state, cat, y1)).toBe(1);
    expect(trace(c.state, c.state.log).filter((x) => x === 'effectsExpired')).toHaveLength(1);
  });

  it("[END-04] the non-turn player's bonuses end at that same moment: a Backup's power on the defender", () => {
    // Y1 (5000) attacks R1 (4500) head on; player 1 answers with a Backup worth +2000, so R1 wins the battle and stays.
    const s0 = attackPhase({ stage: { 2: 'Y1' }, hand: OVER_LIMIT }, { stage: { 2: 'R1' }, hand: ['BKX'] });
    const r1 = idAt(s0, 1, 2);
    const a = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' });
    expect(a.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    const b = go(a.state, { type: 'BACKUP', player: 1, card: cardIn(a.state, 1, 'hand', 'BKX') });
    // Through the battle, the Encore Step (Y1 lost and leaves) and into the End Phase's discard, R1 keeps its bonus.
    const tb = trace(b.state, b.events);
    expect(tb).toContain('move:encoreStep:Y1:stage->waiting');
    expect(tb).not.toContain('effectsExpired');
    expect(b.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(where(b.state, r1)).toBe('stage:1:2:stand');
    expect(currentPower(b.state, cat, r1)).toBe(6500);

    const c = go(b.state, { type: 'DISCARD', player: 0, cards: [cardIn(b.state, 0, 'hand', 'B0')] });
    expect(upTo(trace(c.state, c.events), 'turnStart:1')).toEqual(['action:DISCARD:0', 'move:handLimit:B0:hand->waiting', 'check', 'effectsExpired', 'turnStart:1']);
    expect(c.state.effects).toEqual([]);
    expect(currentPower(c.state, cat, r1)).toBe(4500);
  });

  it('[END-04] a "during this turn" effect, the Shot watch, also lasts until then and no longer; so does a side attack\'s soul loss', () => {
    // Side attack against level 1 R1: soul 1 - 1 = 0, so no damage is dealt and the Shot watch is never used.
    const s0 = attackPhase({ deck: [...PLAIN, 'SHX'], stage: { 2: 'Y1' }, hand: OVER_LIMIT }, { stage: { 2: 'R1' } });
    const y1 = idAt(s0, 0, 2);
    const a = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'side' });
    expect(a.events.filter((e) => e.kind === 'damage')).toEqual([]);
    expect(a.state.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(a.state.watchers).toEqual([{ player: 0, source: { card: y1, epoch: a.state.cards[y1]?.epoch } }]);
    expect(currentSoul(a.state, cat, y1)).toBe(0);

    const b = go(a.state, { type: 'DISCARD', player: 0, cards: [cardIn(a.state, 0, 'hand', 'B0')] });
    expect(upTo(trace(b.state, b.events), 'turnStart:1')).toEqual([
      'action:DISCARD:0',
      'move:handLimit:B0:hand->waiting',
      'check',
      'effectsExpired',
      'turnStart:1',
    ]);
    expect(b.state.watchers).toEqual([]);
    expect(b.state.effects).toEqual([]);
    expect(currentSoul(b.state, cat, y1)).toBe(1);
  });
});
