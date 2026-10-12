// Rule tests for M2: the damage process (CR 4.10), the source of damage
// (CR 4.11), the Damage Step (CR 7.5), the resolution zone as damage uses it
// (CR 3.13.1.3), running out of cards mid-damage (CR 9.2.2.1) and soul
// (CR 2.10). Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentSoul, masterOf, projectEvents, projectView, soulOf, validateCatalog } from '../../src/engine';
import type { Action, AttackType, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const extra: CardDef[] = [
  { id: 'HUSH', name: 'Hushed Sentry', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 3000, soul: 0 },
  { id: 'TRIO', name: 'Thunder Warden', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 3000, soul: 3 },
  { id: 'VOLLEYX', name: 'Echo Volley', kind: 'climax', color: 'yellow', triggers: ['shot'] },
  { id: 'CALLX', name: 'Reserve Call', kind: 'climax', color: 'yellow', triggers: ['standby'] },
];

const cat: CardCatalog = {
  ...catalog,
  ...Object.fromEntries(extra.map((d) => [d.id, d])),
};

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons, so trigger checks and damage do nothing unexpected. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

/** Player 0 attacks (unless `more.active` says otherwise); zones as given, bottom -> top. */
function attackPhase(p0: ZoneSpec, p1: ZoneSpec, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { players: [p0, p1], start: 'attack', ...more });
}

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

/** Applies several actions, returning the final state and every event along the way. */
function goAll(s: GameState, actions: readonly Action[]): Step {
  let state = s;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = go(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const declare = (s: GameState, slot: Slot, attack: AttackType): Action => ({ type: 'ATTACK', player: s.active, slot, attack });

/** Declares an attack and, if it opens a Counter Step, lets the defending player pass it. */
function strike(s: GameState, slot: Slot, attack: AttackType): Step {
  const first = go(s, declare(s, slot, attack));
  const p = first.state.pending;
  if (p?.kind !== 'play' || p.window !== 'counter') return first;
  const second = go(first.state, pass(p.player));
  return { state: second.state, events: [...first.events, ...second.events] };
}

function eventsOf<K extends GameEvent['kind']>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

const defOfId = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** The card on a stage position (the only one there). */
function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const c = s.players[player].stage[slot - 1]?.[0];
  if (!c) throw new Error(`nothing on player ${player}'s position ${slot}`);
  return c.id;
}

const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort();

/** The milestones the damage rules order, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  const d = (id: CardId | null): string => defOfId(s, id);
  return events.flatMap((e): string[] => {
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'trigger') return [`trigger:${e.condition}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'damage') return [`damage:p${e.target}:${e.amount}:${d(e.source)}`];
    if (e.kind === 'damageTaken') return [`damageTaken:${e.cards.map((c) => d(c)).join(',')}`];
    if (e.kind === 'damageCanceled') return [`damageCanceled:${e.cards.map((c) => d(c)).join(',')}`];
    if (e.kind === 'move') return [`move:${e.reason}:${d(e.card)}:p${e.from.player}.${e.from.zone}->p${e.to.player}.${e.to.zone}`];
    if (e.kind === 'battle') return ['battle'];
    if (e.kind === 'auto') return [`auto:${e.ability}`];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}`];
    if (e.kind === 'refresh') return [`refresh:p${e.player}`];
    if (e.kind === 'gameOver') return ['gameOver'];
    return [];
  });
}

/** The trace from the Damage Step's 'step:damage' up to and including the next step it leads to. */
function damageStep(t: readonly string[]): string[] {
  const start = t.indexOf('step:damage');
  if (start < 0) throw new Error('no Damage Step in these events');
  const next = t.findIndex((x, i) => i > start && x.startsWith('step:'));
  return next < 0 ? t.slice(start) : t.slice(start, next + 1);
}

/** The trace from the first entry starting with `from` (inclusive) on. */
function from(t: readonly string[], prefix: string): string[] {
  const i = t.findIndex((x) => x.startsWith(prefix));
  if (i < 0) throw new Error(`no '${prefix}' in the trace`);
  return t.slice(i);
}

const damageKinds = (events: readonly GameEvent[]): string[] =>
  events.filter((e) => e.kind === 'damage' || e.kind === 'damageTaken' || e.kind === 'damageCanceled').map((e) => e.kind);

/**
 * Player 0 attacks directly with Y1 (soul 1 + 1 = 2 damage). Player 1 has one
 * card in the deck: turning it over empties the deck, the refresh puts a
 * seventh card in the clock, and the level up it causes stops the game in the
 * middle of the damage process, after the first card and before the second.
 */
function pausedMidDamage(): { before: GameState; paused: Step; attacker: CardId; first: CardId } {
  const before = attackPhase(
    { deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } },
    { deck: ['B0'], waiting: ['G0', 'G0'], clock: ['R0', 'R0', 'R0', 'R0', 'R0', 'R0'] },
  );
  const attacker = idAt(before, 0, 1);
  const first = cardIn(before, 1, 'deck', 'B0');
  const paused = go(before, declare(before, 1, 'direct'));
  return { before, paused, attacker, first };
}

// =============================================================================
// DMG: the damage process (CR 4.10) and the source of damage (CR 4.11)
// =============================================================================

describe('DMG: the damage process', () => {
  it('[DMG-01] the damaged player turns over the top card of their own deck into their own resolution zone, face up, one card after another', () => {
    // Player 0's deck holds only G0s, player 1's deck has other cards, so whose deck is used is plain to see.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['Y2', 'R0', 'B0'] });
    const b0 = cardIn(s, 1, 'deck', 'B0');
    const r0 = cardIn(s, 1, 'deck', 'R0');
    const r = strike(s, 1, 'direct');
    const t = damageStep(trace(r.state, r.events));

    // Two damage to player 1: the top card (B0) first, then the next (R0), each from player 1's deck to player 1's resolution zone.
    expect(t.filter((x) => x.startsWith('move:'))).toEqual([
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:R0:p1.deck->p1.resolution',
      'move:damageToClock:B0:p1.resolution->p1.clock',
      'move:damageToClock:R0:p1.resolution->p1.clock',
    ]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['Y2']);
    // The attacker's own deck lost only its trigger card, before the Damage Step.
    expect(defsIn(r.state, 0, 'deck')).toEqual(PLAIN.slice(1));
    expect(t.filter((x) => x.includes('p0.deck'))).toEqual([]);

    // Face up: both players are shown which cards were turned over.
    const reveals = r.events.filter((e) => e.kind === 'move' && e.reason === 'damage');
    for (const viewer of [0, 1] as const) {
      expect(projectEvents(reveals, viewer).map((e) => (e.kind === 'move' ? e.card : null))).toEqual([b0, r0]);
    }
  });

  it('[DMG-01] cards are turned over singly: in the middle of the process one card waits in the resolution zone while the next is still in the deck', () => {
    const { paused, first } = pausedMidDamage();
    const s = paused.state;
    // Stopped by the level up between the first and the second card of 2 damage.
    expect(s.pending?.kind).toBe('levelUp');
    expect(s.damage).toMatchObject({ target: 1, amount: 2, cards: [first] });
    expect(s.players[1].resolution).toEqual([first]);
    // The second card has not been turned over yet: the deck still holds a card.
    expect(s.players[1].deck).toHaveLength(1);
    const next = s.players[1].deck[0] as CardId;

    // Resuming turns over the next card (a refresh in between is allowed), then both go to the clock.
    const pending = s.pending;
    if (pending?.kind !== 'levelUp') throw new Error('expected a level up');
    const done = go(s, { type: 'LEVEL_UP', player: 1, card: pending.options[0] as CardId });
    const reveals = eventsOf(done.events, 'move').filter((e) => e.reason === 'damage');
    expect(reveals.map((e) => e.card)).toEqual([next]);
    expect(eventsOf(done.events, 'damageTaken').map((e) => e.cards)).toEqual([[first, next]]);
    expect(done.state.players[1].clock.slice(-2)).toEqual([first, next]);
  });

  it('[DMG-01] damage dealt by an effect (the Shot icon) runs the same process: one card into the resolution zone, then to the clock or canceled', () => {
    // The attack's 2 damage is canceled by YX; Shot then deals 1 damage, which turns over B0.
    const plain = attackPhase({ deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'YX'] });
    const r1 = strike(plain, 1, 'direct');
    expect(from(trace(r1.state, r1.events), 'auto:shot').slice(0, 5)).toEqual([
      'auto:shot',
      'damage:p1:1:-',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damageToClock:B0:p1.resolution->p1.clock',
      'damageTaken:B0',
    ]);
    expect(defsIn(r1.state, 1, 'clock')).toEqual(['B0']);

    // A climax turned over by Shot's damage cancels it just the same.
    const canceled = attackPhase({ deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'RX', 'YX'] });
    const r2 = strike(canceled, 1, 'direct');
    expect(from(trace(r2.state, r2.events), 'auto:shot').slice(0, 5)).toEqual([
      'auto:shot',
      'damage:p1:1:-',
      'move:damage:RX:p1.deck->p1.resolution',
      'move:damageCancel:RX:p1.resolution->p1.waiting',
      'damageCanceled:RX',
    ]);
    expect(defsIn(r2.state, 1, 'clock')).toEqual([]);
    expect(sorted(defsIn(r2.state, 1, 'waiting'))).toEqual(['RX', 'YX']);
    expect(defsIn(r2.state, 1, 'deck')).toEqual(['G0']);
  });

  it('[DMG-02] a climax turned over cancels the damage: every card of this process goes to the waiting room and the rest is never dealt', () => {
    // Y3 attacks directly: soul 2 + 1 = 3 damage. B0 comes first, then YX cancels; the two G0/R0 below are never touched.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['G0', 'R0', 'YX', 'B0'], clock: ['R1'] });
    const b0 = cardIn(s, 1, 'deck', 'B0');
    const yx = cardIn(s, 1, 'deck', 'YX');
    const r = strike(s, 1, 'direct');
    const t = damageStep(trace(r.state, r.events));

    const at = t.indexOf('damage:p1:3:Y3');
    expect(at).toBeGreaterThan(0);
    expect(t.slice(at, at + 7)).toEqual([
      'damage:p1:3:Y3',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:YX:p1.deck->p1.resolution',
      'move:damageCancel:B0:p1.resolution->p1.waiting',
      'move:damageCancel:YX:p1.resolution->p1.waiting',
      'damageCanceled:B0,YX',
      'check',
    ]);
    expect(eventsOf(r.events, 'damageCanceled')).toEqual([expect.objectContaining({ target: 1, cards: [b0, yx] })]);
    // Nothing reaches the clock, nothing is left in the resolution zone, and the process stopped at the climax.
    expect(eventsOf(r.events, 'damageTaken')).toEqual([]);
    expect(t.some((x) => x.startsWith('move:damageToClock'))).toBe(false);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['R1']);
    expect(sorted(r.state.players[1].waiting)).toEqual(sorted([b0, yx]));
    expect(r.state.players[1].resolution).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'R0']);
    expect(r.state.damage).toBeNull();
  });

  it('[DMG-02] a climax cancels whether it is the first card or the last of the N cards', () => {
    // First card: only the climax is turned over (3 damage asked for).
    const s1 = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['B0', 'G0', 'YX'] });
    const r1 = strike(s1, 1, 'direct');
    expect(damageStep(trace(r1.state, r1.events)).filter((x) => x.startsWith('move:') || x.startsWith('damage'))).toEqual([
      'damage:p1:3:Y3',
      'move:damage:YX:p1.deck->p1.resolution',
      'move:damageCancel:YX:p1.resolution->p1.waiting',
      'damageCanceled:YX',
    ]);
    expect(defsIn(r1.state, 1, 'deck')).toEqual(['B0', 'G0']);
    expect(defsIn(r1.state, 1, 'clock')).toEqual([]);

    // Last card: 2 damage, and the second card turned over is a climax. Reaching N does not save the damage.
    const s2 = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'BX', 'B0'] });
    const r2 = strike(s2, 1, 'direct');
    expect(damageStep(trace(r2.state, r2.events)).filter((x) => x.startsWith('move:') || x.startsWith('damage'))).toEqual([
      'damage:p1:2:Y1',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:BX:p1.deck->p1.resolution',
      'move:damageCancel:B0:p1.resolution->p1.waiting',
      'move:damageCancel:BX:p1.resolution->p1.waiting',
      'damageCanceled:B0,BX',
    ]);
    expect(defsIn(r2.state, 1, 'clock')).toEqual([]);
    expect(defsIn(r2.state, 1, 'deck')).toEqual(['G0']);
  });

  it('[DMG-02] only a climax cancels: an event or a character turned over is simply damage', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'YE0', 'R0'] });
    const r = strike(s, 1, 'direct');
    expect(eventsOf(r.events, 'damageCanceled')).toEqual([]);
    expect(eventsOf(r.events, 'damageTaken')).toHaveLength(1);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['R0', 'YE0']);
    expect(defsIn(r.state, 1, 'waiting')).toEqual([]);
  });

  it('[DMG-02] "damage is canceled" in card text means exactly this event: Shot fires after a canceled damage and not after damage that went through', () => {
    const p0: ZoneSpec = { deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y0' } };

    const canceled = strike(attackPhase(p0, { deck: ['G0', 'G0', 'B0', 'YX'] }), 1, 'direct');
    const tc = damageStep(trace(canceled.state, canceled.events));
    expect(tc.indexOf('auto:shot')).toBeGreaterThan(tc.indexOf('damageCanceled:YX'));
    expect(eventsOf(canceled.events, 'damage').map((e) => e.amount)).toEqual([2, 1]);

    const through = strike(attackPhase(p0, { deck: ['G0', 'G0', 'B0', 'R0'] }), 1, 'direct');
    expect(eventsOf(through.events, 'auto')).toEqual([]);
    expect(eventsOf(through.events, 'damageCanceled')).toEqual([]);
    expect(eventsOf(through.events, 'damage').map((e) => e.amount)).toEqual([2]);
    expect(defsIn(through.state, 1, 'clock')).toEqual(['R0', 'B0']);
  });

  it('[DMG-03] with N cards turned over and no climax among them, all N go on top of the clock in the order they were turned over, only after the Nth', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['G0', 'Y0', 'R0', 'B0'], clock: ['R1'] });
    const ids = ['B0', 'R0', 'Y0'].map((d) => cardIn(s, 1, 'deck', d));
    const r = strike(s, 1, 'direct'); // 3 damage
    const t = damageStep(trace(r.state, r.events));
    const at = t.indexOf('damage:p1:3:Y3');
    expect(t.slice(at, at + 8)).toEqual([
      'damage:p1:3:Y3',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:R0:p1.deck->p1.resolution',
      'move:damage:Y0:p1.deck->p1.resolution',
      'move:damageToClock:B0:p1.resolution->p1.clock',
      'move:damageToClock:R0:p1.resolution->p1.clock',
      'move:damageToClock:Y0:p1.resolution->p1.clock',
      'damageTaken:B0,R0,Y0',
    ]);
    expect(eventsOf(r.events, 'damageTaken')).toEqual([expect.objectContaining({ target: 1, cards: ids })]);
    // On top of the card already in the clock; the fourth card stays in the deck.
    expect(defsIn(r.state, 1, 'clock')).toEqual(['R1', 'B0', 'R0', 'Y0']);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0']);
    expect(r.state.players[1].resolution).toEqual([]);
  });

  it('[DMG-03] the process stops at exactly N cards: 1 damage moves one card, 4 damage moves four', () => {
    // 1 damage: a frontal attack by Y1 (soul 1) on R0.
    const one = strike(attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'R0', 'B0'], stage: { 3: 'R0' } }), 1, 'frontal');
    expect(eventsOf(one.events, 'damage').map((e) => e.amount)).toEqual([1]);
    expect(defsIn(one.state, 1, 'clock')).toEqual(['B0']);
    expect(defsIn(one.state, 1, 'deck')).toEqual(['G0', 'R0']);

    // 4 damage: TRIO (soul 3) attacks directly.
    const four = strike(attackPhase({ deck: PLAIN, stage: { 1: 'TRIO', 2: 'Y0' } }, { deck: ['Y2', 'Y1', 'B1', 'B0', 'R1', 'R0'] }), 1, 'direct');
    expect(eventsOf(four.events, 'damage').map((e) => e.amount)).toEqual([4]);
    expect(defsIn(four.state, 1, 'clock')).toEqual(['R0', 'R1', 'B0', 'B1']);
    expect(defsIn(four.state, 1, 'deck')).toEqual(['Y2', 'Y1']);
  });

  it('[DMG-04] a climax put into the clock in the Clock Phase stays there: no damage process runs and nothing is canceled', () => {
    const s = makeState(cat, { players: [{ deck: PLAIN, hand: ['YX', 'G0'] }, { deck: PLAIN }], start: 'clock' });
    expect(s.pending).toEqual({ kind: 'clock', player: 0 });
    const yx = cardIn(s, 0, 'hand', 'YX');
    const r = go(s, { type: 'CLOCK', player: 0, card: yx });

    expect(r.state.players[0].clock).toEqual([yx]);
    expect(r.state.players[0].waiting).toEqual([]);
    expect(r.state.players[0].resolution).toEqual([]);
    expect(damageKinds(r.events)).toEqual([]);
    const yxMoves = eventsOf(r.events, 'move').filter((e) => e.card === yx);
    expect(yxMoves).toEqual([expect.objectContaining({ from: { player: 0, zone: 'hand' }, to: { player: 0, zone: 'clock' }, reason: 'clock' })]);
  });

  it('[DMG-04] the card a refresh puts into the clock is not damage: a climax there neither cancels the damage under way nor is swept to the waiting room with it', () => {
    // Player 1's deck is one card; the waiting room is all climaxes, so the refresh surely puts a climax in the clock.
    const p1: ZoneSpec = { deck: ['B0'], waiting: ['YX', 'RX', 'BX'], stage: { 3: 'G0' } };

    // 1 damage (side attack, level 0 target: no soul change). B0 is turned over, the deck empties, the refresh runs.
    const one = strike(attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, p1), 1, 'side');
    const penalty1 = eventsOf(one.events, 'move').find((e) => e.reason === 'refreshClock');
    if (!penalty1) throw new Error('expected a refresh');
    expect(cat[defOfId(one.state, penalty1.card)]?.kind).toBe('climax');
    expect(penalty1.from).toEqual({ player: 1, zone: 'deck' });
    expect(eventsOf(one.events, 'damageCanceled')).toEqual([]);
    expect(eventsOf(one.events, 'damageTaken').map((e) => defOfId(one.state, e.cards[0] ?? null))).toEqual(['B0']);
    expect(one.state.players[1].clock).toEqual([penalty1.card, cardIn(one.state, 1, 'clock', 'B0')]);

    // 2 damage (direct): after the refresh the next card turned over is a climax, so the damage is canceled.
    // Only B0 and that climax go to the waiting room; the refresh's clock card stays in the clock.
    const two = strike(attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { ...p1, stage: {} }), 1, 'direct');
    const penalty2 = eventsOf(two.events, 'move').find((e) => e.reason === 'refreshClock');
    if (!penalty2) throw new Error('expected a refresh');
    const canceled = eventsOf(two.events, 'damageCanceled');
    expect(canceled).toHaveLength(1);
    expect(canceled[0]?.cards).toHaveLength(2);
    expect(canceled[0]?.cards).not.toContain(penalty2.card);
    expect(two.state.players[1].clock).toEqual([penalty2.card]);
    expect(sorted(two.state.players[1].waiting)).toEqual(sorted(canceled[0]?.cards ?? []));
  });

  it('[DMG-06] the attacking character is the source of the damage it deals in the Damage Step, for direct, frontal and side attacks', () => {
    // Three attackers; player 1 has R0 facing position 3 and R1 (level 1) facing position 1.
    const s0 = attackPhase(
      { deck: PLAIN, stage: { 1: 'Y3', 2: 'Y1', 3: 'Y2' } },
      { deck: ['G0', 'G0', 'G0', 'B0', 'YX', 'G0', 'G0'], stage: { 1: 'R0', 3: 'R1' } },
    );
    const [y3, y1, y2] = [idAt(s0, 0, 1), idAt(s0, 0, 2), idAt(s0, 0, 3)];

    const direct = strike(s0, 2, 'direct'); // Y1: 2 damage, goes through
    expect(eventsOf(direct.events, 'damage').map((e) => [e.source, e.amount])).toEqual([[y1, 2]]);
    expect(eventsOf(direct.events, 'damageTaken').map((e) => e.source)).toEqual([y1]);

    const frontal = strike(direct.state, 3, 'frontal'); // Y2 on R0: 1 damage, canceled by YX
    expect(eventsOf(frontal.events, 'damage').map((e) => [e.source, e.amount])).toEqual([[y2, 1]]);
    expect(eventsOf(frontal.events, 'damageCanceled').map((e) => e.source)).toEqual([y2]);

    const side = strike(frontal.state, 1, 'side'); // Y3 beside R1: soul 2 - 1 = 1 damage
    expect(eventsOf(side.events, 'damage').map((e) => [e.source, e.amount])).toEqual([[y3, 1]]);
    expect(eventsOf(side.events, 'damageTaken').map((e) => e.source)).toEqual([y3]);
  });

  it('[DMG-06] while the process runs, its source is the attacking character object itself', () => {
    const { before, paused, attacker } = pausedMidDamage();
    expect(paused.state.damage?.source).toEqual({ card: attacker, epoch: before.cards[attacker]?.epoch });
    expect(eventsOf(paused.events, 'damage')).toEqual([expect.objectContaining({ target: 1, amount: 2, source: attacker })]);
  });

  it("[DMG-06] Shot tells sources apart: a canceled damage from a different attacker does not set off the first attacker's Shot", () => {
    // Attack 1: Y1 beside R1 (soul 1 - 1 = 0, so no damage) checks a Shot climax: Shot now watches Y1.
    // Attack 2: Y2 attacks directly and its damage is canceled. Its source is Y2, so Y1's Shot stays quiet.
    const s0 = attackPhase(
      { deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y2', 3: 'Y0' } },
      { deck: ['G0', 'G0', 'G0', 'YX'], stage: { 3: 'R1' } },
    );
    const y1 = idAt(s0, 0, 1);
    const y2 = idAt(s0, 0, 2);
    const first = strike(s0, 1, 'side');
    expect(eventsOf(first.events, 'damage')).toEqual([]);
    expect(first.state.watchers.map((w) => w.source.card)).toEqual([y1]);

    const second = strike(first.state, 2, 'direct');
    expect(eventsOf(second.events, 'damageCanceled').map((e) => e.source)).toEqual([y2]);
    expect(eventsOf(second.events, 'auto')).toEqual([]);
    expect(eventsOf(second.events, 'damage').map((e) => e.source)).toEqual([y2]);
    expect(second.state.watchers.map((w) => w.source.card)).toEqual([y1]);
  });
});

// =============================================================================
// DSTEP: the Damage Step (CR 7.5)
// =============================================================================

describe('DSTEP: the Damage Step', () => {
  it('[DSTEP-01] the step opens with its trigger condition and a check timing, and only then does the attacker deal damage to the non-turn player', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: PLAIN });
    const r = strike(s, 1, 'direct');
    const t = damageStep(trace(r.state, r.events));
    expect(t.slice(0, 5)).toEqual(['step:damage', 'trigger:damageStepStart', 'check', 'damage:p1:2:Y1', 'move:damage:G0:p1.deck->p1.resolution']);
    expect(eventsOf(r.events, 'damage')).toEqual([expect.objectContaining({ target: 1, amount: 2, source: idAt(s, 0, 1) })]);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['G0', 'G0']);
    expect(defsIn(r.state, 0, 'clock')).toEqual([]);
  });

  it("[DSTEP-01] the amount is the attacker's soul at that moment, counting every change to it", () => {
    // Y3 (soul 2) attacks from position 1; `top` is the card its trigger check reveals, `facing` what player 1 has.
    const y3 = (top: string[], facing: ZoneSpec['stage'] = {}): GameState =>
      attackPhase({ deck: [...PLAIN, ...top], stage: { 1: 'Y3', 2: 'Y0' } }, { deck: PLAIN, stage: facing });
    const cases: [name: string, state: GameState, attack: AttackType, expected: number][] = [
      ['frontal, no change', y3([], { 3: 'R0' }), 'frontal', 2],
      ['direct, +1', y3([]), 'direct', 3],
      ['frontal with a soul trigger, +1', y3(['YX'], { 3: 'R0' }), 'frontal', 3],
      ['side beside a level 1 character, -1', y3([], { 3: 'R1' }), 'side', 1],
      ['direct with a soul trigger, +2', y3(['YX']), 'direct', 4],
    ];
    for (const [name, state, attack, expected] of cases) {
      const r = strike(state, 1, attack);
      const amounts = eventsOf(r.events, 'damage').map((e) => e.amount);
      expect(amounts, name).toEqual([expected]);
      expect(r.state.players[1].clock, name).toHaveLength(expected);
      expect(currentSoul(r.state, cat, idAt(state, 0, 1)), name).toBe(expected);
    }
  });

  it('[DSTEP-01] when player 1 is the turn player, player 0 takes the damage', () => {
    const s = attackPhase({ deck: ['G0', 'R0', 'B0'] }, { deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { active: 1 });
    expect(s.pending).toEqual({ kind: 'attack', player: 1 });
    const r = strike(s, 1, 'direct');
    expect(eventsOf(r.events, 'damage')).toEqual([expect.objectContaining({ target: 0, amount: 2, source: idAt(s, 1, 1) })]);
    expect(defsIn(r.state, 0, 'clock')).toEqual(['B0', 'R0']);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['G0']);
    expect(defsIn(r.state, 1, 'clock')).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(PLAIN.slice(1)); // only its trigger card left
  });

  it('[DSTEP-02] soul brought down to exactly 0 deals no damage: no damage event, no card turned over, and Shot is still waiting for a first damage', () => {
    // Y1 (soul 1) side-attacks beside R1 (level 1): soul 0. Its trigger check is a Shot climax.
    const s = attackPhase({ deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'R0'], stage: { 3: 'R1' } });
    const attacker = idAt(s, 0, 1);
    const r = strike(s, 1, 'side');
    expect(currentSoul(r.state, cat, attacker)).toBe(0);
    expect(damageStep(trace(r.state, r.events))).toEqual([
      'step:damage',
      'trigger:damageStepStart',
      'check',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
    ]);
    expect(damageKinds(r.events)).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(r.state.players[1].clock).toEqual([]);
    expect(r.state.players[1].resolution).toEqual([]);
    // "The next damage dealt" by Y1 has not happened yet: no zero damage was dealt.
    expect(r.state.watchers.map((w) => w.source.card)).toEqual([attacker]);
  });

  it('[DSTEP-02] negative soul deals no damage either', () => {
    // Y1 beside R3 (level 3): soul 1 - 3 = -2.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'R0'], stage: { 3: 'R3' } });
    const r = strike(s, 1, 'side');
    expect(currentSoul(r.state, cat, idAt(s, 0, 1))).toBe(-2);
    expect(damageKinds(r.events)).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(r.state.players[1].clock).toEqual([]);
  });

  it('[DSTEP-02] a printed soul of 0 deals no damage in a frontal attack (the battle still happens); with the direct attack bonus it deals exactly 1', () => {
    const frontal = strike(attackPhase({ deck: PLAIN, stage: { 1: 'HUSH', 2: 'Y0' } }, { deck: ['G0', 'B0'], stage: { 3: 'G0' } }), 1, 'frontal');
    expect(damageKinds(frontal.events)).toEqual([]);
    expect(damageStep(trace(frontal.state, frontal.events))).toEqual(['step:damage', 'trigger:damageStepStart', 'check', 'check', 'step:battle']);
    expect(eventsOf(frontal.events, 'battle')).toHaveLength(1);
    expect(defsIn(frontal.state, 1, 'deck')).toEqual(['G0', 'B0']);

    const direct = strike(attackPhase({ deck: PLAIN, stage: { 1: 'HUSH', 2: 'Y0' } }, { deck: ['G0', 'B0'] }), 1, 'direct');
    expect(eventsOf(direct.events, 'damage').map((e) => e.amount)).toEqual([1]);
    expect(defsIn(direct.state, 1, 'clock')).toEqual(['B0']);
  });

  it('[DSTEP-03] an attacker that has left the stage deals no damage, even after Encore has put the same card back on its position', () => {
    // Frontal attack by Y1 on position 2. Its trigger check is a Standby climax: Y0 from the waiting room goes onto position 2,
    // the older Y1 is removed by rule action, and player 0 pays Encore to bring Y1 back to position 2 (Y0 is then removed).
    const s0 = attackPhase(
      { deck: [...PLAIN, 'CALLX'], waiting: ['Y0'], stock: ['G0', 'G0', 'G0'], stage: { 1: 'B0', 2: 'Y1' } },
      { deck: ['G0', 'G0', 'B0', 'R0'], stage: { 2: 'R0' } },
    );
    const attacker = idAt(s0, 0, 2);
    const recruit = cardIn(s0, 0, 'waiting', 'Y0');
    const s1 = goAll(s0, [declare(s0, 2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: recruit }, { type: 'CHOOSE_SLOT', player: 0, slot: 2 }]);
    expect(s1.state.pending).toMatchObject({ kind: 'encore', player: 0, card: attacker, slot: 2 });
    const s2 = go(s1.state, { type: 'ACCEPT', player: 0 });
    expect(s2.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    // The same card is back on the same position, but it is a new object.
    expect(idAt(s2.state, 0, 2)).toBe(attacker);
    expect(s2.state.cards[attacker]?.epoch).not.toBe(s2.state.attack?.attacker.epoch);

    const r = go(s2.state, pass(1));
    expect(damageKinds(r.events)).toEqual([]);
    expect(damageStep(trace(r.state, r.events))).toEqual(['step:damage', 'trigger:damageStepStart', 'check', 'check', 'step:battle']);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'G0', 'B0', 'R0']);
    expect(r.state.players[1].clock).toEqual([]);
  });

  it('[DSTEP-03] an attacker sent to the waiting room before the Damage Step deals no damage; left alone, the same attack deals it', () => {
    const s0 = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'R0'], stage: { 3: 'R0' } });
    const attacker = idAt(s0, 0, 1);
    const atCounter = go(s0, declare(s0, 1, 'frontal')).state;
    expect(atCounter.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    const kept = go(atCounter, pass(1));
    expect(eventsOf(kept.events, 'damage')).toEqual([expect.objectContaining({ source: attacker, amount: 1 })]);

    // An effect (simulated) puts the attacker into the waiting room during the Counter Step.
    const gone = ops.deepClone(atCounter);
    ops.moveCard(gone, attacker, { player: 0, zone: 'waiting' }, 'effect');
    const r = go(gone, pass(1));
    expect(damageKinds(r.events)).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(r.state.players[1].clock).toEqual([]);
  });

  it('[DSTEP-03] an attacker whose master has changed deals no damage, though it is the same object on a position with the same number', () => {
    const s0 = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'R0'], stage: { 3: 'R0' } });
    const attacker = idAt(s0, 0, 1);
    const atCounter = go(s0, declare(s0, 1, 'frontal')).state;

    // An effect (simulated) moves the attacker onto player 1's position 1. A stage-to-stage move keeps the object.
    const taken = ops.deepClone(atCounter);
    ops.moveCard(taken, attacker, { player: 1, zone: 'stage', slot: 1 }, 'effect');
    expect(taken.cards[attacker]?.epoch).toBe(atCounter.attack?.attacker.epoch);
    expect(masterOf(taken, attacker)).toBe(1);

    const r = go(taken, pass(1));
    expect(damageKinds(r.events)).toEqual([]);
    expect(defsIn(r.state, 1, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(r.state.players[1].clock).toEqual([]);
    expect(r.state.players[0].clock).toEqual([]);
  });

  it('[DSTEP-04] in a frontal attack the check timing after damage comes next, then the Battle Step; the attack does not end in between', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0'], stage: { 3: 'R0' } });
    const r = strike(s, 1, 'frontal');
    const t = trace(r.state, r.events);
    expect(from(t, 'damageTaken').slice(0, 6)).toEqual(['damageTaken:B0', 'check', 'step:battle', 'trigger:battleStepStart', 'check', 'battle']);
    // "At the end of the attack" comes only after the battle.
    expect(t.filter((x) => x === 'trigger:attackEnd')).toHaveLength(1);
    expect(t.indexOf('trigger:attackEnd')).toBeGreaterThan(t.indexOf('battle'));
  });

  it('[DSTEP-04] that check timing is fully resolved before the Battle Step: a Shot set off by the canceled damage deals its damage first', () => {
    const s = attackPhase({ deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'YX'], stage: { 3: 'R0' } });
    const r = strike(s, 1, 'frontal');
    expect(from(trace(r.state, r.events), 'damageCanceled').slice(0, 8)).toEqual([
      'damageCanceled:YX',
      'check',
      'auto:shot',
      'damage:p1:1:-',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damageToClock:B0:p1.resolution->p1.clock',
      'damageTaken:B0',
      'step:battle',
    ]);
  });

  it('[DSTEP-04] a loss found in that check timing ends the game before any battle', () => {
    // Player 1 is level 3 with six clock cards: the 1 damage makes seven, the level up makes level 4.
    const s = attackPhase(
      { deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } },
      { deck: ['G0', 'B0'], level: ['G0', 'G0', 'G0'], clock: ['R0', 'R0', 'R0', 'R0', 'R0', 'R0'], stage: { 3: 'R0' } },
    );
    const r1 = strike(s, 1, 'frontal');
    const pending = r1.state.pending;
    if (pending?.kind !== 'levelUp') throw new Error('expected a level up');
    expect(eventsOf(r1.events, 'damageTaken')).toHaveLength(1);
    const r2 = go(r1.state, { type: 'LEVEL_UP', player: 1, card: pending.options[0] as CardId });
    const t = trace(r2.state, r2.events);
    expect(t.slice(-3)).toEqual(['check', 'rule:loss', 'gameOver']);
    expect([...trace(r1.state, r1.events), ...t].filter((x) => x === 'step:battle' || x === 'battle')).toEqual([]);
    expect(r2.state.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
  });

  it('[DSTEP-05] after a direct attack: the check timing after damage, then "at the end of the attack" and its check timing, then back to the Attack Declaration Step', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'B0', 'R0'] });
    const r = strike(s, 1, 'direct');
    const t = trace(r.state, r.events);
    expect(from(t, 'damageTaken')).toEqual([
      'damageTaken:R0,B0',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
    expect(t).not.toContain('step:battle');
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(r.state.step).toBe('declaration');
    expect(r.state.attack).toBeNull();
  });

  it('[DSTEP-05] a side attack also ends after its Damage Step: no Battle Step and no battle, even against a weaker facing character', () => {
    // Y3 (10000) beside R1 (4500, level 1): soul 2 - 1 = 1.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['G0', 'B0'], stage: { 3: 'R1' } });
    const r = strike(s, 1, 'side');
    const t = trace(r.state, r.events);
    expect(from(t, 'damageTaken')).toEqual([
      'damageTaken:B0',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
    expect(eventsOf(r.events, 'battle')).toEqual([]);
    expect(r.state.players[1].stage[2]).toEqual([expect.objectContaining({ id: idAt(s, 1, 3), orientation: 'stand' })]);
    expect(r.state.attack).toBeNull();
  });

  it('[DSTEP-05] a Shot set off in a side attack resolves in the check timing after damage, before "at the end of the attack"', () => {
    const s = attackPhase({ deck: [...PLAIN, 'VOLLEYX'], stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['G0', 'B0', 'YX'], stage: { 3: 'R1' } });
    const r = strike(s, 1, 'side');
    expect(from(trace(r.state, r.events), 'damageCanceled')).toEqual([
      'damageCanceled:YX',
      'check',
      'auto:shot',
      'damage:p1:1:-',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damageToClock:B0:p1.resolution->p1.clock',
      'damageTaken:B0',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
  });

  it('[DSTEP-05] with no character left to attack, the return to the Attack Declaration Step is what ends the phase', () => {
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1' } }, { deck: PLAIN });
    const r = strike(s, 1, 'direct');
    expect(from(trace(r.state, r.events), 'trigger:attackEnd').slice(0, 6)).toEqual([
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
      'step:encore',
    ]);
  });
});

// =============================================================================
// ZONE-38 / ZONE-39: the resolution zone and the clock during damage (CR 3.13.1.3)
// =============================================================================

describe('ZONE: damage cards in the resolution zone and the clock', () => {
  it("[ZONE-38] a card turned over by damage sits face up in the damaged player's resolution zone until the process ends", () => {
    const { paused, first } = pausedMidDamage();
    const s = paused.state;
    expect(s.players[1].resolution).toEqual([first]);
    expect(s.players[1].deck).not.toContain(first);
    expect(s.players[1].clock).not.toContain(first);
    expect(s.players[0].resolution).toEqual([]);
    for (const viewer of [0, 1] as const) {
      expect(projectView(s, viewer).players[1].resolution).toEqual([{ id: first, def: 'B0' }]);
    }
  });

  it("[ZONE-38] from the resolution zone the cards go to the owner's waiting room when canceled and to the owner's clock otherwise", () => {
    const base = (p1deck: string[]): GameState => attackPhase({ deck: PLAIN, hand: ['R1'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: p1deck });
    // Put a card owned by player 0 on top of player 1's deck (simulated effect), so owner and damaged player differ.
    const withForeignTop = (p1deck: string[]): { s: GameState; foreign: CardId } => {
      const s = ops.deepClone(base(p1deck));
      const foreign = cardIn(s, 0, 'hand', 'R1');
      ops.moveCard(s, foreign, { player: 1, zone: 'deck' }, 'effect');
      return { s, foreign };
    };

    // Not canceled: player 0's card is turned over into player 1's resolution zone, then goes to player 0's clock.
    const a = withForeignTop(['G0', 'B0']);
    const ra = strike(a.s, 1, 'direct');
    const b0 = cardIn(a.s, 1, 'deck', 'B0');
    expect(
      eventsOf(ra.events, 'move')
        .filter((e) => e.card === a.foreign || e.card === b0)
        .map((e) => [e.card, e.reason, e.from, e.to]),
    ).toEqual([
      [a.foreign, 'damage', { player: 1, zone: 'deck' }, { player: 1, zone: 'resolution' }],
      [b0, 'damage', { player: 1, zone: 'deck' }, { player: 1, zone: 'resolution' }],
      [a.foreign, 'damageToClock', { player: 1, zone: 'resolution' }, { player: 0, zone: 'clock' }],
      [b0, 'damageToClock', { player: 1, zone: 'resolution' }, { player: 1, zone: 'clock' }],
    ]);
    expect(ra.state.players[0].clock).toEqual([a.foreign]);
    expect(ra.state.players[1].clock).toEqual([b0]);

    // Canceled: player 0's card goes to player 0's waiting room, the climax to player 1's.
    const c = withForeignTop(['G0', 'YX']);
    const rc = strike(c.s, 1, 'direct');
    const yx = cardIn(c.s, 1, 'deck', 'YX');
    expect(eventsOf(rc.events, 'damageCanceled').map((e) => e.cards)).toEqual([[c.foreign, yx]]);
    expect(rc.state.players[0].waiting).toEqual([c.foreign]);
    expect(rc.state.players[1].waiting).toEqual([yx]);
    expect(rc.state.players[0].clock).toEqual([]);
    expect(rc.state.players[1].clock).toEqual([]);
    expect(rc.state.players[1].resolution).toEqual([]);
  });

  it('[ZONE-39] damage cards go on top of the clock in the order they were turned over, with no choice for the player, and that order decides the bottom seven at level up', () => {
    // Five cards in the clock, then 3 damage: B0, R1, B1 in that order make eight.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['Y2', 'B1', 'R1', 'B0'], clock: ['G0', 'G0', 'G0', 'G0', 'G0'] });
    const [b0, r1, b1] = ['B0', 'R1', 'B1'].map((d) => cardIn(s, 1, 'deck', d)) as [CardId, CardId, CardId];
    const r = strike(s, 1, 'direct');

    // The first decision after the damage is the level up: nobody was asked to order the damage cards.
    const pending = r.state.pending;
    if (pending?.kind !== 'levelUp') throw new Error('expected a level up');
    expect(eventsOf(r.events, 'damageTaken').map((e) => e.cards)).toEqual([[b0, r1, b1]]);
    expect(r.state.players[1].clock.slice(5)).toEqual([b0, r1, b1]);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['G0', 'G0', 'G0', 'G0', 'G0', 'B0', 'R1', 'B1']);
    // Bottom seven: the five old cards and the first two damage cards. The last one turned over is the eighth.
    expect(pending.options).toEqual([...s.players[1].clock, b0, r1]);
    expect(pending.options).not.toContain(b1);

    const done = go(r.state, { type: 'LEVEL_UP', player: 1, card: r1 });
    expect(done.state.players[1].level).toEqual([r1]);
    expect(done.state.players[1].clock).toEqual([b1]);
  });

  it('[ZONE-39] a refresh in the middle does not disturb the order of the damage cards themselves', () => {
    const { paused, first } = pausedMidDamage();
    const pending = paused.state.pending;
    if (pending?.kind !== 'levelUp') throw new Error('expected a level up');
    const second = paused.state.players[1].deck[0] as CardId;
    const done = go(paused.state, { type: 'LEVEL_UP', player: 1, card: pending.options[0] as CardId });
    // The refresh's clock card comes first; the two damage cards follow in the order they were turned over.
    const penalties = eventsOf(done.events, 'move')
      .filter((e) => e.reason === 'refreshClock')
      .map((e) => e.card);
    expect(done.state.players[1].clock).toEqual([...penalties, first, second]);
  });
});

// =============================================================================
// REF-03: out of cards in the middle of a damage process (CR 9.2.2.1)
// =============================================================================

describe('REF-03: deck and waiting room empty mid-damage', () => {
  it('[REF-03] the deck empties mid-damage with an empty waiting room and no climax revealed: that player loses at once, without waiting for a check timing', () => {
    // 3 damage, but player 1 has two cards and an empty waiting room.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['G0', 'B0'] });
    const r = strike(s, 1, 'direct');
    expect(from(trace(r.state, r.events), 'damage:')).toEqual([
      'damage:p1:3:Y3',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:G0:p1.deck->p1.resolution',
      'rule:loss',
      'gameOver',
    ]);
    expect(r.state.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'deckOut' });
    expect(eventsOf(r.events, 'ruleAction')).toEqual([expect.objectContaining({ rule: 'loss', players: [1] })]);
    // The process never finished: nothing reached the clock.
    expect(r.state.players[1].clock).toEqual([]);
    expect(defsIn(r.state, 1, 'resolution')).toEqual(['B0', 'G0']);
  });

  it('[REF-03] this holds even when the card that empties the deck would have been the last card of the damage', () => {
    // 1 damage (side attack beside a level 0 character), and player 1's deck is that one card.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['B0'], stage: { 3: 'G0' } });
    const r = strike(s, 1, 'side');
    expect(from(trace(r.state, r.events), 'damage:')).toEqual(['damage:p1:1:Y1', 'move:damage:B0:p1.deck->p1.resolution', 'rule:loss', 'gameOver']);
    expect(r.state.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'deckOut' });
    expect(eventsOf(r.events, 'damageTaken')).toEqual([]);
  });

  it('[REF-03] a climax in the resolution zone when the deck empties prevents the loss: the damage is canceled, then the refresh uses those cards and play goes on', () => {
    // 3 damage: B0, then YX empties the deck. The climax is in the resolution zone, so no loss.
    const s = attackPhase({ deck: PLAIN, stage: { 1: 'Y3', 2: 'Y0' } }, { deck: ['YX', 'B0'] });
    const r = strike(s, 1, 'direct');
    const t = from(trace(r.state, r.events), 'damage:');
    expect(t.slice(0, 7)).toEqual([
      'damage:p1:3:Y3',
      'move:damage:B0:p1.deck->p1.resolution',
      'move:damage:YX:p1.deck->p1.resolution',
      'move:damageCancel:B0:p1.resolution->p1.waiting',
      'move:damageCancel:YX:p1.resolution->p1.waiting',
      'damageCanceled:B0,YX',
      'refresh:p1',
    ]);
    expect(t).not.toContain('rule:loss');
    expect(r.state.result).toBeNull();
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(sorted([...defsIn(r.state, 1, 'deck'), ...defsIn(r.state, 1, 'clock')])).toEqual(['B0', 'YX']);
    expect(r.state.players[1].deck).toHaveLength(1);
  });

  it('[REF-03] outside a damage process an empty deck and waiting room wait for the check timing: a trigger check that empties the deck does not end the game on the spot', () => {
    const s = attackPhase({ deck: ['G0'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: PLAIN });
    const r = go(s, declare(s, 1, 'direct'));
    expect(from(trace(r.state, r.events), 'move:triggerCheck')).toEqual([
      'move:triggerCheck:G0:p0.deck->p0.resolution',
      'move:triggerToStock:G0:p0.resolution->p0.stock',
      'check',
      'rule:loss',
      'gameOver',
    ]);
    expect(r.state.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
    expect(damageKinds(r.events)).toEqual([]);
  });
});

// =============================================================================
// CARD-17: soul (CR 2.10)
// =============================================================================

describe('CARD-17: soul', () => {
  it('[CARD-17] soul belongs to characters only and is a whole count of icons: card data that breaks this is rejected', () => {
    const base = { id: 'X', name: 'Test Piece', color: 'yellow' } as const;
    const codes = (def: Record<string, unknown>): string[] => validateCatalog({ X: def as unknown as CardDef }).map((e) => e.code);
    const character = (more: Record<string, unknown>): Record<string, unknown> => ({
      ...base,
      kind: 'character',
      level: 0,
      cost: 0,
      power: 1000,
      ...more,
    });

    for (const soul of [0, 1, 2, 3]) expect(codes(character({ soul })), `soul ${soul}`).toEqual([]);
    expect(codes(character({}))).toEqual(['CATALOG_MISSING']);
    for (const soul of [1.5, -1, '2']) expect(codes(character({ soul })), `soul ${String(soul)}`).toEqual(['CATALOG_RANGE']);
    expect(codes({ ...base, kind: 'event', level: 0, cost: 0, soul: 1 })).toEqual(['CATALOG_FIELD']);
    expect(codes({ ...base, kind: 'climax', soul: 1 })).toEqual(['CATALOG_FIELD']);
    // A card without soul reads as 0 soul.
    for (const id of ['YE0', 'YX', 'RC0']) expect(soulOf(cat[id] as CardDef)).toBe(0);
  });

  it('[CARD-17] the soul count is the base damage a character deals: 0, 1, 2 and 3 soul deal 0, 1, 2 and 3 damage in a frontal attack', () => {
    const counts = [
      ['HUSH', 0],
      ['Y1', 1],
      ['Y3', 2],
      ['TRIO', 3],
    ] as const;
    for (const [def, soul] of counts) {
      const s = attackPhase({ deck: PLAIN, stage: { 1: def, 2: 'Y0' } }, { deck: ['G0', 'G0', 'G0', 'G0'], stage: { 3: 'R0' } });
      const attacker = idAt(s, 0, 1);
      expect(soulOf(cat[def] as CardDef), def).toBe(soul);
      expect(currentSoul(s, cat, attacker), def).toBe(soul);
      const r = strike(s, 1, 'frontal');
      const amounts = eventsOf(r.events, 'damage').map((e) => e.amount);
      expect(amounts, def).toEqual(soul > 0 ? [soul] : []);
      expect(r.state.players[1].clock, def).toHaveLength(soul);
    }
  });
});
