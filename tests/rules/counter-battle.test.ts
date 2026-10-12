// Rule tests for M2: the Counter Step (CR 7.4) and the counter icon (CR 2.8),
// the Backup keyword (CR 10.5), the Battle Step (CR 7.6) and power (CR 2.9).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, canBackup, currentPower, legalActions, validate, validateCatalog } from '../../src/engine';
import type { Action, AttackType, CardCatalog, CardDef, CardId, GameEvent, GameState, Orientation, PlayerId, Slot } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const guard = (id: string, name: string, power: number, backup: NonNullable<CardDef['backup']>, more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'red',
  level: 0,
  cost: 0,
  power,
  soul: 1,
  backup,
  ...more,
});

const extra: CardDef[] = [
  // Backup characters. Backup (X), Level (Y), costing `stock` stock plus the card itself.
  guard('BK0', 'Ember Squire', 1500, { power: 3000, level: 0, stock: 1 }),
  guard('BK500', 'Ember Spark', 1000, { power: 500, level: 0, stock: 0 }),
  guard('BK1000', 'Ember Flicker', 1000, { power: 1000, level: 0, stock: 0 }),
  guard('BKL2', 'Ember Warden', 6000, { power: 2000, level: 2, stock: 1 }, { level: 2, cost: 1 }),
  guard('BKS2', 'Ember Quartermaster', 2000, { power: 2000, level: 0, stock: 2 }),
  // A blue level 3 card whose Backup asks for level 0: the card's own level and color do not matter for its ability.
  guard('BKX', 'Azure Oracle', 9000, { power: 1000, level: 0, stock: 1 }, { color: 'blue', level: 3, cost: 2, soul: 2 }),
  // A character marked with the counter icon but with no Backup to use.
  { id: 'RCC', name: 'Crimson Lookout', kind: 'character', color: 'red', level: 0, cost: 0, power: 2000, soul: 1, counter: true },
  // A plain event that is the twin of the catalog's counter event RC0, minus the counter icon.
  { id: 'RN0', name: 'Red Feint', kind: 'event', color: 'red', level: 0, cost: 1 },
  // A level 1 counter event.
  { id: 'RC1', name: 'Crimson Riposte', kind: 'event', color: 'red', level: 1, cost: 1, counter: true },
  // Power against everything else: high level, soul and cost but low power, and the reverse.
  { id: 'BIG', name: 'Iron Colossus', kind: 'character', color: 'yellow', level: 3, cost: 2, power: 3000, soul: 2 },
  { id: 'SMALL', name: 'Swift Sparrow', kind: 'character', color: 'green', level: 0, cost: 0, power: 3500, soul: 1 },
  // A climax whose trigger icon returns a character to hand, and one that calls a character from the waiting room.
  { id: 'RETX', name: 'Homeward Gale', kind: 'climax', color: 'yellow', triggers: ['return'] },
  { id: 'STBX', name: 'Reserve Horn', kind: 'climax', color: 'yellow', triggers: ['standby'] },
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons: trigger checks do nothing and damage always sticks. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

/** Starts at the Attack Phase; player 0 is the turn player unless `more` says otherwise. */
function attackPhase(p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start: 'attack', players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }], ...more });
}

const attack = (slot: Slot, type: AttackType, player: PlayerId = 0): Action => ({ type: 'ATTACK', player, slot, attack: type });
const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const backup = (player: PlayerId, card: CardId): Action => ({ type: 'BACKUP', player, card });
const playEvent = (player: PlayerId, card: CardId): Action => ({ type: 'PLAY_EVENT', player, card });

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

/** The error code validate gives, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const r = validate(s, cat, action);
  return r.ok ? 'ok' : r.error.code;
}

const defOf = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'phase') return [`phase:${e.phase}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'trigger') return [`trigger:${e.condition}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'attack') return [`attack:${e.attack}:${defOf(s, e.card)}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.zone}->${e.to.zone}`];
    if (e.kind === 'played') return [`played:${defOf(s, e.card)}`];
    if (e.kind === 'backup') return [`backup:${defOf(s, e.card)}->${defOf(s, e.target)}:+${e.power}`];
    if (e.kind === 'modifier') return [`modifier:${defOf(s, e.card)}:${e.stat}:${e.amount}`];
    if (e.kind === 'battle') return [`battle:${defOf(s, e.attacker)}>${defOf(s, e.defender)}:reversed=${e.reversed.map((c) => defOf(s, c)).join('+')}`];
    if (e.kind === 'orientation') return [`orientation:${defOf(s, e.card)}:${e.orientation}`];
    if (e.kind === 'damage') return [`damage:${e.target}:${e.amount}`];
    if (e.kind === 'damageTaken' || e.kind === 'damageCanceled') return [e.kind];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'auto') return [`auto:${e.ability}:${defOf(s, e.card)}`];
    if (e.kind === 'effectsExpired') return ['effectsExpired'];
    return [];
  });
}

/** The part of a trace from the first entry equal to `from` up to (not including) the first later entry equal to `to`. */
function between(t: readonly string[], from: string, to: string): string[] {
  const start = t.indexOf(from);
  if (start < 0) throw new Error(`no ${from} in [${t.join(', ')}]`);
  const end = t.indexOf(to, start + 1);
  return end < 0 ? t.slice(start) : t.slice(start, end);
}

const steps = (t: readonly string[]): string[] => t.filter((x) => x.startsWith('step:'));
const playTimings = (t: readonly string[]): string[] => t.filter((x) => x.startsWith('playTiming:'));
const battles = (t: readonly string[]): string[] => t.filter((x) => x.startsWith('battle:'));
const reversals = (t: readonly string[]): string[] => t.filter((x) => x.startsWith('orientation:') && x.endsWith(':reverse'));
const count = (t: readonly string[], x: string): number => t.filter((y) => y === x).length;

/** Legal actions as compact strings ("PASS", "PLAY_EVENT:RC0", "BACKUP:BK0", ...), sorted. */
function offers(s: GameState, player?: PlayerId): string[] {
  return legalActions(s, cat, player)
    .map((a) => {
      if ('card' in a && typeof a.card === 'string') return `${a.type}:${defOf(s, a.card)}${a.type === 'PLAY_CHARACTER' ? `@${a.slot}` : ''}`;
      if (a.type === 'ATTACK') return `ATTACK:${a.slot}:${a.attack}`;
      if (a.type === 'SWAP') return `SWAP:${a.a}-${a.b}`;
      return a.type;
    })
    .sort();
}

function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const id = s.players[player].stage[slot - 1]?.[0]?.id;
  if (id === undefined) throw new Error(`no card at player ${player}'s position ${slot}`);
  return id;
}

/** Orientation of a card on either stage, or undefined if it is not on a stage. */
function orientationOf(s: GameState, card: CardId): Orientation | undefined {
  for (const player of [0, 1] as const) {
    for (const cards of s.players[player].stage) {
      const c = cards.find((x) => x.id === card);
      if (c) return c.orientation;
    }
  }
  return undefined;
}

const counterPrompt = (player: PlayerId) => ({ kind: 'play', player, window: 'counter' }) as const;

// =============================================================================
// CTR-01 .. CTR-03: the Counter Step (CR 7.4)
// =============================================================================

describe('CTR: the Counter Step', () => {
  it('[CTR-01] a frontal attack reaches the Counter Step: its start trigger, then a check timing, then a play timing for the non-turn player', () => {
    // Y0 on position 1 keeps the Attack Phase going after this attack.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' } });
    const r = go(s0, attack(2, 'frontal'));
    const t = trace(r.state, r.events);

    // The Trigger Step's last check timing leads straight into the Counter Step, in this exact order.
    expect(between(t, 'move:triggerToStock:G0:resolution->stock', 'nothing-after')).toEqual([
      'move:triggerToStock:G0:resolution->stock',
      'check',
      'step:counter',
      'trigger:counterStepStart',
      'check',
      'playTiming:1:counter',
    ]);
    expect(r.state.step).toBe('counter');
    expect(r.state.pending).toEqual(counterPrompt(1));
    // The Damage Step has not begun: no damage has been dealt yet.
    expect(steps(t)).not.toContain('step:damage');
    expect(r.state.players[1].clock).toEqual([]);

    // Passing ends the step: a check timing, then the Damage Step.
    const p = go(r.state, pass(1));
    const tp = trace(p.state, p.events);
    expect(tp.slice(0, 5)).toEqual(['action:PASS:1', 'check', 'step:damage', 'trigger:damageStepStart', 'check']);
  });

  it('[CTR-01] the turn player gets no play timing in the Counter Step, neither before nor after the non-turn player', () => {
    // Player 0 holds a counter event and stock, so a play timing for them would show up as legal actions.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' }, hand: ['RC0'], stock: ['G0'] }, { stage: { 2: 'R1' }, hand: ['RC0'], stock: ['G0'] });
    const r = go(s0, attack(2, 'frontal'));
    expect(r.state.pending).toEqual(counterPrompt(1));
    expect(playTimings(trace(r.state, r.events))).toEqual(['playTiming:1:counter']);

    // Nothing is legal for player 0 while the Counter Step's play timing is open.
    expect(legalActions(r.state, cat, 0)).toEqual([]);
    expect(attempt(r.state, pass(0))).toBe('NOT_YOUR_DECISION');
    expect(attempt(r.state, playEvent(0, cardIn(r.state, 0, 'hand', 'RC0')))).toBe('NOT_YOUR_DECISION');

    // After player 1 acts, the step ends without any play timing for player 0 on the way to the Damage Step.
    for (const finish of [pass(1), playEvent(1, cardIn(r.state, 1, 'hand', 'RC0'))]) {
      const f = go(r.state, finish);
      const tf = trace(f.state, f.events);
      expect(playTimings(between(tf, tf[0] ?? '', 'step:declaration'))).toEqual([]);
      expect(f.state.pending).toEqual({ kind: 'attack', player: 0 });
      expect(defsIn(f.state, 0, 'hand')).toEqual(['RC0']);
    }
  });

  it('[CTR-01] direct and side attacks never reach the Counter Step: no start trigger and no play timing for anyone', () => {
    // Player 0's position 1 faces player 1's empty position 3 (direct); position 2 faces R1 (frontal or side).
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0', 'BK0'], stock: ['G0', 'G0'] });
    for (const [slot, kind] of [
      [1, 'direct'],
      [2, 'side'],
    ] as const) {
      const r = go(s0, attack(slot, kind));
      const t = trace(r.state, r.events);
      expect(steps(t), kind).toEqual(['step:trigger', 'step:damage', 'step:declaration']);
      expect(t, kind).not.toContain('trigger:counterStepStart');
      expect(playTimings(t), kind).toEqual([]);
      // Player 1 never had a decision: the next one is player 0's attack choice, and their hand is untouched.
      expect(r.state.pending, kind).toEqual({ kind: 'attack', player: 0 });
      expect(defsIn(r.state, 1, 'hand'), kind).toEqual(['RC0', 'BK0']);
      expect(r.state.players[1].stock, kind).toHaveLength(2);
    }
    // The same position attacking frontally does get the Counter Step.
    const f = go(s0, attack(2, 'frontal'));
    expect(f.state.pending).toEqual(counterPrompt(1));
  });

  it("[CTR-01] on player 1's turn the Counter Step's play timing goes to player 0, the non-turn player", () => {
    const s0 = attackPhase({ stage: { 2: 'Y1' }, hand: ['RC0'], stock: ['G0'] }, { stage: { 1: 'R0', 2: 'R1' } }, { active: 1 });
    expect(s0.pending).toEqual({ kind: 'attack', player: 1 });
    const r = go(s0, attack(2, 'frontal', 1));
    const t = trace(r.state, r.events);
    expect(between(t, 'step:counter', 'nothing-after')).toEqual(['step:counter', 'trigger:counterStepStart', 'check', 'playTiming:0:counter']);
    expect(r.state.pending).toEqual(counterPrompt(0));
    expect(legalActions(r.state, cat, 1)).toEqual([]);
    expect(offers(r.state)).toEqual(['PASS', 'PLAY_EVENT:RC0']);
  });

  it('[CTR-01] the attack type decides: a frontal attack whose defender was returned to hand in the Trigger Step still has a Counter Step', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'RETX'], stage: { 1: 'Y0', 2: 'Y1' } }, { stage: { 2: 'Y2' }, hand: ['RC0'], stock: ['G0'] });
    const defender = idAt(s0, 1, 2);
    const r = goAll(s0, [attack(2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: defender }]);
    expect(r.state.players[1].hand).toContain(defender);
    const t = trace(r.state, r.events);
    expect(between(t, 'step:counter', 'nothing-after')).toEqual(['step:counter', 'trigger:counterStepStart', 'check', 'playTiming:1:counter']);
    expect(r.state.pending).toEqual(counterPrompt(1));
    expect(offers(r.state)).toEqual(['PASS', 'PLAY_EVENT:RC0']);
  });

  it('[CTR-01] after the play timing, its check timing is resolved in full (rule actions and automatic abilities) before the Damage Step starts', () => {
    // Player 1 has 3 stock, so a character of theirs leaving the stage brings an Encore prompt.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1', 4: 'B0' }, hand: ['G0'], stock: ['B1', 'B1', 'B1'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(s1.pending).toEqual(counterPrompt(1));
    const b0 = idAt(s1, 1, 4);

    // An effect (simulated) puts another character on position 4 while the play timing is open.
    const s2 = ops.deepClone(s1);
    const g0 = cardIn(s2, 1, 'hand', 'G0');
    ops.moveCard(s2, g0, { player: 1, zone: 'stage', slot: 4 }, 'effect');

    // Passing: the check timing removes the older character, then offers its Encore. The Damage Step waits.
    const a = go(s2, pass(1));
    expect(trace(a.state, a.events)).toEqual(['action:PASS:1', 'check', 'rule:extraCards:B0', 'move:ruleAction:B0:stage->waiting']);
    expect(a.state.step).toBe('counter');
    expect(a.state.pending).toEqual({ kind: 'encore', player: 1, card: b0, slot: 4, cost: 3 });

    // Paying the Encore brings B0 back, which in turn removes G0 (now the older card). Only then does the Damage Step begin.
    const b = go(a.state, { type: 'ACCEPT', player: 1 });
    const tb = trace(b.state, b.events);
    expect(between(tb, 'action:ACCEPT:1', 'trigger:damageStepStart')).toEqual([
      'action:ACCEPT:1',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'move:cost:B1:stock->waiting',
      'auto:encore:B0',
      'move:encore:B0:waiting->stage',
      'rule:extraCards:G0',
      'move:ruleAction:G0:stage->waiting',
      'step:damage',
    ]);
    expect(orientationOf(b.state, b0)).toBe('rest');
    expect(defsIn(b.state, 1, 'waiting')).toEqual(['B1', 'B1', 'B1', 'G0']);
  });

  it('[CTR-02] in the Counter Step only counter-icon events and Backup are offered; characters, climaxes, plain events and moves are refused', () => {
    const s0 = attackPhase(
      { stage: { 1: 'Y0', 2: 'Y2' } },
      { stage: { 2: 'R1', 4: 'B0' }, hand: ['RC0', 'RN0', 'R0', 'RX', 'BK0', 'RCC'], stock: ['G0', 'G0'], clock: ['R0'] },
    );
    const s = go(s0, attack(2, 'frontal')).state;
    expect(s.pending).toEqual(counterPrompt(1));
    expect(offers(s)).toEqual(['BACKUP:BK0', 'PASS', 'PLAY_EVENT:RC0']);

    const card = (def: string): CardId => cardIn(s, 1, 'hand', def);
    // A plain event, even one that is otherwise the same as the counter event.
    expect(attempt(s, playEvent(1, card('RN0')))).toBe('ILLEGAL_ACTION');
    // Characters from hand, whether plain, with Backup, or marked with a counter icon.
    for (const def of ['R0', 'BK0', 'RCC']) {
      expect(attempt(s, { type: 'PLAY_CHARACTER', player: 1, card: card(def), slot: 3 }), def).toBe('ILLEGAL_ACTION');
    }
    // A climax, and moving characters between positions.
    expect(attempt(s, { type: 'PLAY_CLIMAX', player: 1, card: card('RX') })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'SWAP', player: 1, a: 2, b: 4 })).toBe('ILLEGAL_ACTION');
    // A character ability without the counter icon (no Backup) cannot be used as one.
    for (const def of ['R0', 'RCC']) expect(attempt(s, backup(1, card(def))), def).toBe('ILLEGAL_ACTION');

    // Contrast: in player 1's own main phase the plain event and the characters are playable.
    const main = makeState(cat, { start: 'main', active: 1, players: [{ deck: PLAIN }, { deck: PLAIN, hand: ['RN0', 'R0'], stock: ['G0'] }] });
    expect(offers(main)).toEqual(expect.arrayContaining(['PLAY_EVENT:RN0', 'PLAY_CHARACTER:R0@1']));
  });

  it('[CTR-02] with only non-counter cards in hand the play timing is still given, but passing is the one choice, and nothing leaves the hand', () => {
    const s0 = attackPhase(
      { stage: { 1: 'Y0', 2: 'Y2' } },
      { stage: { 2: 'R1' }, hand: ['RN0', 'R0', 'RX', 'RCC'], stock: ['G0', 'G0'], level: ['R0'], clock: ['R0'] },
    );
    const s = go(s0, attack(2, 'frontal')).state;
    expect(s.pending).toEqual(counterPrompt(1));
    expect(offers(s)).toEqual(['PASS']);
    const r = go(s, pass(1));
    const t = trace(r.state, r.events);
    expect(t.filter((x) => x.startsWith('played:') || x.startsWith('move:play:') || x.startsWith('move:cost:'))).toEqual([]);
    expect(defsIn(r.state, 1, 'hand')).toEqual(['RN0', 'R0', 'RX', 'RCC']);
    expect(r.state.players[1].stock).toHaveLength(2);
  });

  it('[CTR-03] after one counter event the step ends: no second play timing, though more counter cards are playable', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0', 'RC0', 'BK0'], stock: ['G0', 'G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(offers(s1)).toEqual(['BACKUP:BK0', 'PASS', 'PLAY_EVENT:RC0', 'PLAY_EVENT:RC0']);

    const r = go(s1, playEvent(1, cardIn(s1, 1, 'hand', 'RC0', 0)));
    const t = trace(r.state, r.events);
    expect(between(t, 'action:PLAY_EVENT:1', 'trigger:damageStepStart')).toEqual([
      'action:PLAY_EVENT:1',
      'move:cost:G0:stock->waiting',
      'played:RC0',
      'move:play:RC0:hand->resolution',
      'move:eventResolved:RC0:resolution->waiting',
      'check',
      'step:damage',
    ]);
    expect(playTimings(t)).toEqual([]);
    // The other cards are still in hand, still affordable, but the sub-phase ran on to the next declaration.
    expect(defsIn(r.state, 1, 'hand')).toEqual(['RC0', 'BK0']);
    expect(r.state.players[1].stock).toHaveLength(1);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(attempt(r.state, playEvent(1, cardIn(r.state, 1, 'hand', 'RC0')))).toBe('NOT_YOUR_DECISION');
    expect(attempt(r.state, backup(1, cardIn(r.state, 1, 'hand', 'BK0')))).toBe('NOT_YOUR_DECISION');
    expect(count(trace(r.state, r.state.log), 'playTiming:1:counter')).toBe(1);
  });

  it('[CTR-03] after one Backup the step ends the same way; the other Backup and the counter event stay in hand', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0', 'BK0', 'BK0'], stock: ['G0', 'G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const r = go(s1, backup(1, cardIn(s1, 1, 'hand', 'BK0', 0)));
    const t = trace(r.state, r.events);
    expect(between(t, 'action:BACKUP:1', 'trigger:damageStepStart')).toEqual([
      'action:BACKUP:1',
      'move:cost:G0:stock->waiting',
      'move:cost:BK0:hand->waiting',
      'backup:BK0->R1:+3000',
      'modifier:R1:power:3000',
      'check',
      'step:damage',
    ]);
    expect(playTimings(t)).toEqual([]);
    expect(count(t, 'modifier:R1:power:3000')).toBe(1);
    expect(defsIn(r.state, 1, 'hand')).toEqual(['RC0', 'BK0']);
    expect(currentPower(r.state, cat, idAt(r.state, 1, 2))).toBe(7500);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[CTR-03] choosing to do nothing also ends it; by contrast a main-phase play is followed by another play timing', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0'], stock: ['G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const r = go(s1, pass(1));
    expect(playTimings(trace(r.state, r.events))).toEqual([]);
    expect(steps(trace(r.state, r.events))).toEqual(['step:damage', 'step:battle', 'step:declaration']);

    // In the main phase (CR 8.5.2.2) playing an event gives the player another play timing.
    const m = makeState(cat, { start: 'main', players: [{ deck: PLAIN, hand: ['YE0', 'YE0'] }, { deck: PLAIN }] });
    const after = go(m, playEvent(0, cardIn(m, 0, 'hand', 'YE0')));
    expect(playTimings(trace(after.state, after.events))).toEqual(['playTiming:0:main']);
    expect(after.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });
});

// =============================================================================
// CARD-13: the counter icon (CR 2.8.1-2.8.2)
// =============================================================================

describe('CARD-13: the counter icon', () => {
  it("[CARD-13] a counter-icon event can be played from hand in the Counter Step of the opponent's turn", () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0'], stock: ['B0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const rc0 = cardIn(s1, 1, 'hand', 'RC0');
    expect(legalActions(s1, cat)).toContainEqual(playEvent(1, rc0));
    expect(attempt(s1, playEvent(1, rc0))).toBe('ok');

    const r = go(s1, playEvent(1, rc0));
    // Its cost is paid, it counts as played, passes through the resolution zone and ends in the waiting room.
    expect(between(trace(r.state, r.events), 'action:PLAY_EVENT:1', 'check')).toEqual([
      'action:PLAY_EVENT:1',
      'move:cost:B0:stock->waiting',
      'played:RC0',
      'move:play:RC0:hand->resolution',
      'move:eventResolved:RC0:resolution->waiting',
    ]);
    expect(r.state.players[1].hand).toEqual([]);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['B0', 'RC0']);
  });

  it('[CARD-13] the same event without the counter icon cannot be played there', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC0', 'RN0'], stock: ['B0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(offers(s1)).toEqual(['PASS', 'PLAY_EVENT:RC0']);
    expect(attempt(s1, playEvent(1, cardIn(s1, 1, 'hand', 'RN0')))).toBe('ILLEGAL_ACTION');
    // Only the icon differs between the two.
    const { counter: _icon, id: _a, name: _b, ...rc0 } = cat.RC0 as CardDef;
    const { id: _c, name: _d, ...rn0 } = cat.RN0 as CardDef;
    expect(rn0).toEqual(rc0);
  });

  it('[CARD-13] a counter-icon card is still played as a card: its level, color and cost requirements apply', () => {
    const at = (p1: ZoneSpec): string[] => {
      const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RC1'], ...p1 });
      return offers(go(s0, attack(2, 'frontal')).state);
    };
    expect(at({ stock: ['G0'] })).toEqual(['PASS']); // level 0: too low
    expect(at({ stock: ['G0'], level: ['G0'] })).toEqual(['PASS']); // level 1, but no red in level or clock
    expect(at({ level: ['R0'] })).toEqual(['PASS']); // level and color fine, but no stock for the cost
    expect(at({ stock: ['G0'], level: ['R0'] })).toEqual(['PASS', 'PLAY_EVENT:RC1']);
    expect(at({ stock: ['G0'], level: ['G0'], clock: ['R0'] })).toEqual(['PASS', 'PLAY_EVENT:RC1']);
  });

  it("[CARD-13] it is the opponent's turn that matters: in the Counter Step of their own attack, the holder of a counter card has no play", () => {
    // Player 0 attacks while holding a playable counter event; only player 1 gets the Counter Step's play timing.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' }, hand: ['RC0'], stock: ['G0'] }, { stage: { 2: 'R1' } });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(s1.step).toBe('counter');
    expect(s1.pending).toEqual(counterPrompt(1));
    expect(legalActions(s1, cat, 0)).toEqual([]);
    expect(attempt(s1, playEvent(0, cardIn(s1, 0, 'hand', 'RC0')))).toBe('NOT_YOUR_DECISION');
    const done = go(s1, pass(1)).state;
    expect(defsIn(done, 0, 'hand')).toEqual(['RC0']);
  });
});

// =============================================================================
// KW-07, KW-08: Backup (CR 10.5)
// =============================================================================

describe('KW: Backup', () => {
  it('[KW-07] the player whose character is frontal attacked can use Backup from hand in that Counter Step', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['BK0'], stock: ['G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const bk = cardIn(s1, 1, 'hand', 'BK0');
    expect(s1.pending).toEqual(counterPrompt(1));
    expect(legalActions(s1, cat)).toContainEqual(backup(1, bk));
    expect(attempt(s1, backup(1, bk))).toBe('ok');

    const r = go(s1, backup(1, bk));
    expect(r.state.players[1].hand).toEqual([]);
    expect(r.state.players[1].waiting).toContain(bk);
    expect(trace(r.state, r.events)).toContain('backup:BK0->R1:+3000');
  });

  it('[KW-07] a side or direct attack has no Counter Step, so a Backup card in hand never gets used', () => {
    // Position 1 faces player 1's empty position 3 (direct); position 2 faces R1 (side).
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['BK0'], stock: ['G0'] });
    const r1 = idAt(s0, 1, 2);
    for (const [slot, kind] of [
      [1, 'direct'],
      [2, 'side'],
    ] as const) {
      const r = go(s0, attack(slot, kind));
      const t = trace(r.state, r.events);
      expect(t.filter((x) => x.startsWith('backup:')), kind).toEqual([]);
      expect(playTimings(t), kind).toEqual([]);
      expect(defsIn(r.state, 1, 'hand'), kind).toEqual(['BK0']);
      expect(currentPower(r.state, cat, r1), kind).toBe(4500);
      expect(r.state.pending, kind).toEqual({ kind: 'attack', player: 0 });
      expect(attempt(r.state, backup(1, cardIn(r.state, 1, 'hand', 'BK0'))), kind).toBe('NOT_YOUR_DECISION');
    }
  });

  it('[KW-07] Backup is used from hand only: the same card on the stage, in the waiting room or in the clock cannot use it', () => {
    const s0 = attackPhase(
      { stage: { 1: 'Y0', 2: 'Y2' } },
      { stage: { 2: 'R1', 4: 'BK0' }, waiting: ['BK0'], clock: ['BK0'], stock: ['G0', 'G0'] },
    );
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(s1.pending).toEqual(counterPrompt(1));
    expect(offers(s1)).toEqual(['PASS']);
    for (const zone of ['stage', 'waiting', 'clock'] as const) {
      const card = cardIn(s1, 1, zone, 'BK0');
      expect(attempt(s1, backup(1, card)), zone).toBe('ILLEGAL_ACTION');
      expect(canBackup(s1, cat, 1, card), zone).toBe(false);
    }
  });

  it('[KW-07] the turn player cannot use Backup on their own turn: not in the main phase, not in the Counter Step of their own attack', () => {
    const main = makeState(cat, { start: 'main', players: [{ deck: PLAIN, hand: ['BK0'], stock: ['G0'], stage: { 2: 'R1' } }, { deck: PLAIN }] });
    const bkMain = cardIn(main, 0, 'hand', 'BK0');
    expect(main.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(offers(main).filter((x) => x.startsWith('BACKUP'))).toEqual([]);
    expect(attempt(main, backup(0, bkMain))).toBe('ILLEGAL_ACTION');
    expect(canBackup(main, cat, 0, bkMain)).toBe(false);

    // Both players hold a usable Backup card during player 0's frontal attack; only the defender's player may use theirs.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' }, hand: ['BK0'], stock: ['G0'] }, { stage: { 2: 'R1' }, hand: ['BK0'], stock: ['G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(s1.step).toBe('counter');
    const mine = cardIn(s1, 0, 'hand', 'BK0');
    expect(legalActions(s1, cat, 0)).toEqual([]);
    expect(attempt(s1, backup(0, mine))).toBe('NOT_YOUR_DECISION');
    expect(canBackup(s1, cat, 0, mine)).toBe(false);
    expect(canBackup(s1, cat, 1, cardIn(s1, 1, 'hand', 'BK0'))).toBe(true);
  });

  it("[KW-07] on player 1's turn it is player 0, the non-turn player, who may use Backup", () => {
    const s0 = attackPhase({ stage: { 2: 'Y1' }, hand: ['BK0'], stock: ['G0'] }, { stage: { 1: 'R0', 2: 'R1' }, hand: ['BK0'], stock: ['G0'] }, { active: 1 });
    const s1 = go(s0, attack(2, 'frontal', 1)).state;
    expect(s1.pending).toEqual(counterPrompt(0));
    expect(offers(s1)).toEqual(['BACKUP:BK0', 'PASS']);
    const r = go(s1, backup(0, cardIn(s1, 0, 'hand', 'BK0')));
    expect(trace(r.state, r.events)).toContain('backup:BK0->Y1:+3000');
    expect(defsIn(r.state, 1, 'hand')).toEqual(['BK0']);
  });

  it('[KW-08] after the cost (stock, then the card itself) the defending character gets +X power; nothing else does', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 1: 'R0', 2: 'R1', 4: 'B0' }, hand: ['BK0'], stock: ['G0', 'B1'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const attacker = idAt(s1, 0, 2);
    const defender = idAt(s1, 1, 2);
    const r = go(s1, backup(1, cardIn(s1, 1, 'hand', 'BK0')));
    const t = trace(r.state, r.events);
    // The power change comes only after the whole cost has been paid. The top stock card (B1) goes first.
    expect(between(t, 'action:BACKUP:1', 'check')).toEqual([
      'action:BACKUP:1',
      'move:cost:B1:stock->waiting',
      'move:cost:BK0:hand->waiting',
      'backup:BK0->R1:+3000',
      'modifier:R1:power:3000',
    ]);
    expect(t.filter((x) => x.startsWith('modifier:'))).toEqual(['modifier:R1:power:3000']);
    expect(currentPower(r.state, cat, defender)).toBe(4500 + 3000);
    // The attacker and player 1's other characters keep their printed power.
    expect(currentPower(r.state, cat, attacker)).toBe(7000);
    expect(currentPower(r.state, cat, idAt(r.state, 1, 1))).toBe(3000);
    expect(currentPower(r.state, cat, idAt(r.state, 1, 4))).toBe(2500);
    expect(defsIn(r.state, 1, 'stock')).toEqual(['G0']);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['B1', 'BK0']);
    // The raised power wins the battle: 7500 against 7000.
    expect(battles(t)).toEqual(['battle:Y2>R1:reversed=Y2']);
  });

  it('[KW-08] the +X lasts until end of turn: past the battle and the rest of the Attack Phase, gone once the turn is over', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['BK0', 'G0'], stock: ['G0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    const defender = idAt(s1, 1, 2);
    const backed = go(s1, backup(1, cardIn(s1, 1, 'hand', 'BK0'))).state;
    // Back at the Attack Declaration Step, the sub-phase is over but the turn is not.
    expect(backed.step).toBe('declaration');
    expect(currentPower(backed, cat, defender)).toBe(7500);

    // End the Attack Phase: Encore Step, End Phase, then player 1's turn begins.
    const next = go(backed, pass(0));
    const t = trace(next.state, next.events);
    const expired = t.indexOf('effectsExpired');
    expect(expired).toBeGreaterThan(t.indexOf('phase:end'));
    expect(next.state.active).toBe(1);
    expect(next.state.turn).toBe(3);
    expect(next.state.effects).toEqual([]);
    expect(currentPower(next.state, cat, defender)).toBe(4500);
  });

  it("[KW-08] the player's level must be Y or higher: Level 2 Backup is refused at levels 0 and 1, allowed at 2 and 3", () => {
    const at = (level: string[], p1: ZoneSpec = {}, p0: ZoneSpec = {}): GameState => {
      const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' }, ...p0 }, { stage: { 2: 'R1' }, hand: ['BKL2'], stock: ['G0'], level, ...p1 });
      return go(s0, attack(2, 'frontal')).state;
    };
    const can = (s: GameState): boolean => offers(s).includes('BACKUP:BKL2');
    expect(can(at([]))).toBe(false);
    expect(can(at(['G0']))).toBe(false);
    expect(can(at(['G0', 'G0']))).toBe(true);
    expect(can(at(['G0', 'G0', 'G0']))).toBe(true);
    const low = at(['G0']);
    expect(attempt(low, backup(1, cardIn(low, 1, 'hand', 'BKL2')))).toBe('ILLEGAL_ACTION');

    // Only the player's own level zone counts: six clock cards or the opponent's level do not.
    expect(can(at(['G0'], { clock: ['G0', 'G0', 'G0', 'G0', 'G0', 'G0'] }, { level: ['Y0', 'Y0'] }))).toBe(false);

    // At level 2 it works and gives its +2000.
    const ok = at(['G0', 'G0']);
    const r = go(ok, backup(1, cardIn(ok, 1, 'hand', 'BKL2')));
    expect(currentPower(r.state, cat, idAt(r.state, 1, 2))).toBe(6500);
  });

  it("[KW-08] Backup is an ability, not a played card: the card's own level and color do not matter, only Level Y", () => {
    // BKX is a blue level 3 card with Backup Level 0. Player 1 is level 0 with no blue anywhere.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['BKX'], stock: ['G0'], clock: ['R0'] });
    const s1 = go(s0, attack(2, 'frontal')).state;
    expect(offers(s1)).toEqual(['BACKUP:BKX', 'PASS']);
    const r = go(s1, backup(1, cardIn(s1, 1, 'hand', 'BKX')));
    expect(trace(r.state, r.events)).toContain('backup:BKX->R1:+1000');
    expect(currentPower(r.state, cat, idAt(r.state, 1, 2))).toBe(5500);
  });

  it('[KW-08] the cost must be paid in full: one stock short refuses it, exactly enough allows it', () => {
    const at = (stock: string[]): GameState => {
      const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['BKS2'], stock });
      return go(s0, attack(2, 'frontal')).state;
    };
    const short = at(['G0']);
    expect(offers(short)).toEqual(['PASS']);
    expect(attempt(short, backup(1, cardIn(short, 1, 'hand', 'BKS2')))).toBe('ILLEGAL_ACTION');

    const exact = at(['G0', 'B0']);
    expect(offers(exact)).toEqual(['BACKUP:BKS2', 'PASS']);
    const r = go(exact, backup(1, cardIn(exact, 1, 'hand', 'BKS2')));
    expect(r.state.players[1].stock).toEqual([]);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['B0', 'G0', 'BKS2']);
    expect(trace(r.state, r.events)).toContain('backup:BKS2->R1:+2000');
  });
});

// =============================================================================
// BTL-01 .. BTL-03: the Battle Step (CR 7.6)
// =============================================================================

describe('BTL: the Battle Step', () => {
  /** Player 0 attacks frontally from position 2; Y0 on position 1 keeps the phase going afterwards. */
  function battleOf(attacker: string, defender: string, p1: ZoneSpec = {}): { s1: GameState; a: CardId; d: CardId } {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: attacker } }, { stage: { 2: defender }, ...p1 });
    const s1 = go(s0, attack(2, 'frontal')).state;
    return { s1, a: idAt(s1, 0, 2), d: idAt(s1, 1, 2) };
  }

  it('[BTL-01] after the start trigger and its check timing, powers are compared and the weaker defender is reversed', () => {
    const { s1, a, d } = battleOf('Y2', 'R1'); // 7000 against 4500
    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(between(t, 'step:battle', 'trigger:attackEnd')).toEqual([
      'step:battle',
      'trigger:battleStepStart',
      'check',
      'battle:Y2>R1:reversed=R1',
      'orientation:R1:reverse',
      'check',
    ]);
    expect(orientationOf(r.state, d)).toBe('reverse');
    // The winner is untouched: the attacker stays in the Rest State it took when attacking.
    expect(orientationOf(r.state, a)).toBe('rest');
    expect(reversals(t)).toEqual(['orientation:R1:reverse']);
  });

  it('[BTL-01] the attacker is reversed when the defender has more power, and the defender keeps standing', () => {
    const { s1, a, d } = battleOf('Y1', 'Y2'); // 5000 against 7000
    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(battles(t)).toEqual(['battle:Y1>Y2:reversed=Y1']);
    expect(reversals(t)).toEqual(['orientation:Y1:reverse']);
    expect(orientationOf(r.state, a)).toBe('reverse');
    expect(orientationOf(r.state, d)).toBe('stand');
  });

  it('[BTL-01] equal power reverses both characters', () => {
    const { s1, a, d } = battleOf('Y1', 'Y1'); // 5000 against 5000
    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(battles(t)).toEqual(['battle:Y1>Y1:reversed=Y1+Y1']);
    expect(reversals(t)).toHaveLength(2);
    expect(orientationOf(r.state, a)).toBe('reverse');
    expect(orientationOf(r.state, d)).toBe('reverse');
  });

  it('[BTL-01] current power is compared, modifiers included: +500 makes a tie, +1000 wins, none loses', () => {
    // Attacker Y1 is 5000; defender R1 is 4500 before Backup.
    const { s1, a, d } = battleOf('Y1', 'R1', { hand: ['BK500', 'BK1000'] });
    const outcome = (action: Action): [Orientation | undefined, Orientation | undefined, string[]] => {
      const r = go(s1, action);
      return [orientationOf(r.state, a), orientationOf(r.state, d), battles(trace(r.state, r.events))];
    };
    expect(outcome(pass(1))).toEqual(['rest', 'reverse', ['battle:Y1>R1:reversed=R1']]);
    expect(outcome(backup(1, cardIn(s1, 1, 'hand', 'BK500')))).toEqual(['reverse', 'reverse', ['battle:Y1>R1:reversed=Y1+R1']]);
    expect(outcome(backup(1, cardIn(s1, 1, 'hand', 'BK1000')))).toEqual(['reverse', 'stand', ['battle:Y1>R1:reversed=Y1']]);
  });

  it('[BTL-01] the loser is only put into the Reverse State: it stays on its stage position until the Encore Step', () => {
    const { s1, d } = battleOf('Y2', 'R1');
    const r = go(s1, pass(1));
    expect(r.state.step).toBe('declaration');
    expect(idAt(r.state, 1, 2)).toBe(d);
    expect(orientationOf(r.state, d)).toBe('reverse');
    expect(r.events.filter((e) => e.kind === 'move' && e.card === d)).toEqual([]);
    expect(r.state.players[1].waiting).toEqual([]);
  });

  it('[BTL-02] a defender that was returned to hand leaves nothing to compare: the weaker attacker is not reversed', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'RETX'], stage: { 1: 'Y0', 2: 'Y1' } }, { stage: { 2: 'Y2' } });
    const attacker = idAt(s0, 0, 2); // 5000
    const defender = idAt(s0, 1, 2); // 7000
    const s1 = goAll(s0, [attack(2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: defender }]).state;
    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(between(t, 'step:battle', 'trigger:attackEnd')).toEqual(['step:battle', 'trigger:battleStepStart', 'check', 'check']);
    expect(battles(t)).toEqual([]);
    expect(reversals(t)).toEqual([]);
    expect(orientationOf(r.state, attacker)).toBe('rest');
    expect(r.state.players[1].hand).toContain(defender);
  });

  it('[BTL-02] an attacker that left the stage leaves nothing to compare: neither the weaker defender nor the newcomer on its position is reversed', () => {
    // Standby icon: Y0 comes from the waiting room onto position 2, and the attacker (placed earlier) goes to the waiting room.
    const s0 = attackPhase({ deck: [...PLAIN, 'STBX'], waiting: ['Y0'], stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' } });
    const attacker = idAt(s0, 0, 2); // 7000
    const defender = idAt(s0, 1, 2); // 4500
    const recruit = cardIn(s0, 0, 'waiting', 'Y0'); // 2000
    const s1 = goAll(s0, [attack(2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: recruit }, { type: 'CHOOSE_SLOT', player: 0, slot: 2 }]).state;
    expect(s1.step).toBe('counter');
    expect(s1.players[0].waiting).toContain(attacker);
    expect(idAt(s1, 0, 2)).toBe(recruit);

    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(steps(t)).toEqual(['step:damage', 'step:battle', 'step:declaration']);
    expect(battles(t)).toEqual([]);
    expect(reversals(t)).toEqual([]);
    expect(orientationOf(r.state, defender)).toBe('stand');
    expect(orientationOf(r.state, recruit)).toBe('rest');
  });

  /**
   * Player 0 attacks frontally from position 3, which faces player 1's position 1.
   * Y0 on position 2 (facing an empty position) keeps the phase going afterwards.
   */
  function battleFrom3(attacker: string, defender: string): { s1: GameState; a: CardId; d: CardId } {
    const s0 = attackPhase({ stage: { 2: 'Y0', 3: attacker } }, { stage: { 1: defender } });
    const s1 = go(s0, attack(3, 'frontal')).state;
    return { s1, a: idAt(s1, 0, 3), d: idAt(s1, 1, 1) };
  }

  it('[BTL-02] a defender whose master changed is no longer in battle: no comparison, nobody reversed', () => {
    const { s1, a, d } = battleFrom3('Y1', 'Y2'); // 5000 against 7000
    // An effect (simulated) moves the defender over to player 0's stage, keeping the position number (1).
    // Only the change of master separates it from the defender it was.
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, d, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    expect(s2.cards[d]?.epoch).toBe(s1.cards[d]?.epoch);
    const r = go(s2, pass(1));
    const t = trace(r.state, r.events);
    expect(t).toContain('step:battle');
    expect(battles(t)).toEqual([]);
    expect(reversals(t)).toEqual([]);
    expect(orientationOf(r.state, a)).toBe('rest');
    expect(orientationOf(r.state, d)).toBe('stand');
    expect(idAt(r.state, 0, 1)).toBe(d);
    // The attacker itself is unaffected and still dealt its damage.
    expect(t.filter((x) => x.startsWith('damage:'))).toEqual(['damage:1:1']);
  });

  it('[BTL-02] an attacker whose master changed is no longer in battle: no damage, no comparison, nobody reversed', () => {
    const { s1, a, d } = battleFrom3('Y2', 'R1'); // 7000 against 4500
    // An effect (simulated) moves the attacker over to player 1's stage, keeping the position number (3).
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, a, { player: 1, zone: 'stage', slot: 3 }, 'effect');
    expect(s2.cards[a]?.epoch).toBe(s1.cards[a]?.epoch);
    const r = go(s2, pass(1));
    const t = trace(r.state, r.events);
    expect(t).toContain('step:battle');
    expect(t.filter((x) => x.startsWith('damage:'))).toEqual([]);
    expect(battles(t)).toEqual([]);
    expect(reversals(t)).toEqual([]);
    expect(orientationOf(r.state, d)).toBe('stand');
    expect(orientationOf(r.state, a)).toBe('rest');
  });

  it('[BTL-02] a character that took the defender\'s position is not the defender and does not battle', () => {
    // Player 1 has no stock, so the removed defender brings no Encore prompt.
    const { s1, a, d } = battleOf('Y2', 'R1', { hand: ['R0'] }); // 7000 against 4500; newcomer R0 is 3000
    const s2 = ops.deepClone(s1);
    const newcomer = cardIn(s2, 1, 'hand', 'R0');
    ops.moveCard(s2, newcomer, { player: 1, zone: 'stage', slot: 2 }, 'effect');
    const r = go(s2, pass(1));
    const t = trace(r.state, r.events);
    // The older card leaves by rule action in the check timing that closes the Counter Step.
    expect(t.slice(0, 4)).toEqual(['action:PASS:1', 'check', 'rule:extraCards:R1', 'move:ruleAction:R1:stage->waiting']);
    expect(battles(t)).toEqual([]);
    expect(reversals(t)).toEqual([]);
    expect(orientationOf(r.state, newcomer)).toBe('stand');
    expect(orientationOf(r.state, a)).toBe('rest');
    expect(r.state.players[1].waiting).toContain(d);
  });

  it('[BTL-03] after the battle: a check timing, the end-of-attack trigger, another check timing, then back to the Attack Declaration Step', () => {
    const { s1, a } = battleOf('Y2', 'R1');
    const r = go(s1, pass(1));
    const t = trace(r.state, r.events);
    expect(t.slice(t.indexOf('orientation:R1:reverse'))).toEqual([
      'orientation:R1:reverse',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
    // The sub-phase is over: no attack in progress, and a fresh declaration where the rested attacker cannot attack again.
    expect(r.state.step).toBe('declaration');
    expect(r.state.attack).toBeNull();
    expect(r.state.attacks).toBe(1);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(offers(r.state)).toEqual(['ATTACK:1:direct', 'PASS']);
    expect(orientationOf(r.state, a)).toBe('rest');
  });

  it('[BTL-03] the next attack gets its own whole sub-phase; the beginning-of-attack-phase trigger is not met again', () => {
    // Position 2 faces R1, position 3 faces R0 on player 1's position 1.
    const s0 = attackPhase({ stage: { 2: 'Y2', 3: 'Y1' } }, { stage: { 1: 'R0', 2: 'R1' } });
    const r = goAll(s0, [attack(2, 'frontal'), pass(1), attack(3, 'frontal'), pass(1)]);
    const t = trace(r.state, r.events);
    expect(steps(t)).toEqual([
      'step:trigger',
      'step:counter',
      'step:damage',
      'step:battle',
      'step:declaration',
      'step:trigger',
      'step:counter',
      'step:damage',
      'step:battle',
      'step:declaration',
      'step:encore',
    ]);
    expect(battles(t)).toEqual(['battle:Y2>R1:reversed=R1', 'battle:Y1>R0:reversed=R0']);
    expect(count(t, 'trigger:attackEnd')).toBe(2);
    const whole = trace(r.state, r.state.log);
    expect(count(whole, 'trigger:attackPhaseStart')).toBe(1);
    expect(count(whole, 'trigger:attackDeclarationStart')).toBe(3);
  });

  it('[BTL-03] with nothing to compare the sub-phase still ends the same way: check timing, end-of-attack trigger, check timing, declaration', () => {
    const { s1, d } = battleOf('Y1', 'Y2');
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, d, { player: 0, zone: 'stage', slot: 4 }, 'effect');
    const r = go(s2, pass(1));
    const t = trace(r.state, r.events);
    expect(between(t, 'step:battle', 'nothing-after')).toEqual([
      'step:battle',
      'trigger:battleStepStart',
      'check',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
    expect(r.state.attack).toBeNull();
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
  });
});

// =============================================================================
// CARD-16: power (CR 2.9.1)
// =============================================================================

describe('CARD-16: power', () => {
  it('[CARD-16] power alone decides the battle: a higher level, more soul and a bigger cost do not help', () => {
    // BIG: level 3, soul 2, cost 2, power 3000. SMALL: level 0, soul 1, cost 0, power 3500.
    const attacking = attackPhase({ stage: { 1: 'Y0', 2: 'BIG' } }, { stage: { 2: 'SMALL' } });
    const r1 = goAll(attacking, [attack(2, 'frontal'), pass(1)]);
    expect(battles(trace(r1.state, r1.events))).toEqual(['battle:BIG>SMALL:reversed=BIG']);
    expect(orientationOf(r1.state, idAt(attacking, 1, 2))).toBe('stand');

    // The other way round: BIG defending against SMALL is reversed all the same.
    const defending = attackPhase({ stage: { 1: 'Y0', 2: 'SMALL' } }, { stage: { 2: 'BIG' } });
    const r2 = goAll(defending, [attack(2, 'frontal'), pass(1)]);
    expect(battles(trace(r2.state, r2.events))).toEqual(['battle:SMALL>BIG:reversed=BIG']);
    expect(orientationOf(r2.state, idAt(defending, 0, 2))).toBe('rest');
  });

  it('[CARD-16] only characters carry power: an event or a climax with power is rejected, and a character must have it', () => {
    const codes = (defs: CardDef[]): string[] => validateCatalog(Object.fromEntries(defs.map((d) => [d.id, d]))).map((e) => `${e.code}:${e.message}`);
    const event = { id: 'EVP', name: 'Strong Memo', kind: 'event', color: 'red', level: 0, cost: 0, power: 1000 } as CardDef;
    const climax = { id: 'CXP', name: 'Strong Dawn', kind: 'climax', color: 'red', power: 1000 } as CardDef;
    const powerless = { id: 'CHP', name: 'Faint Shade', kind: 'character', color: 'red', level: 0, cost: 0, soul: 1 } as CardDef;
    expect(codes([event])).toEqual([expect.stringMatching(/^CATALOG_FIELD:.*power/)]);
    expect(codes([climax])).toEqual([expect.stringMatching(/^CATALOG_FIELD:.*power/)]);
    expect(codes([powerless])).toEqual([expect.stringMatching(/^CATALOG_MISSING:.*power/)]);
    // The same cards without the stray field, and the character with its power, are fine.
    const { power: _e, ...plainEvent } = event;
    const { power: _c, ...plainClimax } = climax;
    expect(codes([plainEvent as CardDef, plainClimax as CardDef, { ...powerless, power: 0 }])).toEqual([]);
  });
});
