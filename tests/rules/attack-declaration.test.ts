// Rule tests for M2: the Attack Phase and its Attack Declaration Step
// (CR 7.1-7.2), with stage facing (CR 3.6.6). Every title starts with the
// rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { canBackup, currentSoul, legalActions, projectView, validate } from '../../src/engine';
import type { Action, AttackType, CardCatalog, CardDef, CardId, GameEvent, GameState, Orientation, PlayerId, Slot } from '../../src/engine';
import { act, cardIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const extra: CardDef[] = [
  // A level 0 character with a lot of soul, so soul changes show up in the damage dealt.
  { id: 'HV', name: 'Bastion Herald', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 6000, soul: 4 },
  // A character the opponent can use as Backup in the Counter Step.
  { id: 'RB', name: 'Crimson Bulwark', kind: 'character', color: 'red', level: 0, cost: 0, power: 1000, soul: 1, backup: { power: 3000, level: 0, stock: 1 } },
  // Climaxes used as trigger cards.
  { id: 'XR', name: 'Ashen Recall', kind: 'climax', color: 'yellow', triggers: ['return'] },
  { id: 'XS', name: 'Ashen Vigil', kind: 'climax', color: 'yellow', triggers: ['standby'] },
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
const pass = (player: PlayerId = 0): Action => ({ type: 'PASS', player });

/** The error code validate gives, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const r = validate(s, cat, action);
  return r.ok ? 'ok' : r.error.code;
}

/** Attack choices on offer, as "slot:type", sorted. */
function attackChoices(s: GameState, player?: PlayerId): string[] {
  return legalActions(s, cat, player)
    .flatMap((a) => (a.type === 'ATTACK' ? [`${a.slot}:${a.attack}`] : []))
    .sort();
}

function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const id = s.players[player].stage[slot - 1]?.[0]?.id;
  if (id === undefined) throw new Error(`no card at player ${player}'s position ${slot}`);
  return id;
}

function orientationOf(s: GameState, card: CardId): Orientation | undefined {
  for (const player of [0, 1] as const) {
    for (const cards of s.players[player].stage) {
      const c = cards.find((x) => x.id === card);
      if (c) return c.orientation;
    }
  }
  return undefined;
}

function slotOf(s: GameState, card: CardId): number | undefined {
  for (const player of [0, 1] as const) {
    const i = s.players[player].stage.findIndex((cards) => cards.some((c) => c.id === card));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);

function eventsOf<K extends GameEvent['kind']>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

/** A compact, readable trace of the events that matter for attack flow. */
function tag(e: GameEvent): string {
  if (e.kind === 'phase') return `phase:${e.phase}`;
  if (e.kind === 'step') return `step:${e.step}`;
  if (e.kind === 'trigger') return `trigger:${e.condition}`;
  if (e.kind === 'checkTiming') return 'check';
  if (e.kind === 'action') return `action:${e.action.type}`;
  if (e.kind === 'attack') return `attack:${e.attack}`;
  if (e.kind === 'modifier') return `modifier:${e.stat}${e.amount > 0 ? '+' : ''}${e.amount}`;
  if (e.kind === 'orientation') return `orientation:${e.orientation}`;
  if (e.kind === 'move') return `move:${e.reason}`;
  if (e.kind === 'ruleAction') return `rule:${e.rule}`;
  if (e.kind === 'playTiming') return `playTiming:${e.window}`;
  return e.kind;
}
const tags = (events: readonly GameEvent[]): string[] => events.map(tag);
const stepsIn = (events: readonly GameEvent[]): string[] => eventsOf(events, 'step').map((e) => e.step);
const count = (xs: readonly string[], x: string): number => xs.filter((y) => y === x).length;

/** Asserts that `part` appears in `whole` as one contiguous run. */
function expectRun(whole: readonly string[], part: readonly string[]): void {
  const at = whole.findIndex((_, i) => part.every((p, k) => whole[i + k] === p));
  expect(at, `expected the run [${part.join(', ')}] in [${whole.join(', ')}]`).toBeGreaterThanOrEqual(0);
}

// =============================================================================
// ATK-01, ATK-02: the Attack Phase and the Attack Sub-Phase (CR 6.7.1, 7.1)
// =============================================================================

describe('ATK: the Attack Phase and the Attack Sub-Phase', () => {
  it('[ATK-01] the Attack Phase opens with the Attack Declaration Step, and only the turn player gets to attack', () => {
    const s = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 1: 'R1', 2: 'R0', 3: 'R1' } });

    expect(s.phase).toBe('attack');
    expect(s.step).toBe('declaration');
    // The first thing in the phase is the Attack Declaration Step; no other step comes before it.
    expect(tags(s.log).slice(0, 2)).toEqual(['phase:attack', 'step:declaration']);
    expect(stepsIn(s.log)).toEqual(['declaration']);

    // The decision belongs to the turn player and lists their own center characters only.
    expect(s.pending).toEqual({ kind: 'attack', player: 0 });
    expect(attackChoices(s)).toEqual(['1:frontal', '1:side', '2:frontal', '2:side']);
    expect(legalActions(s, cat, 1)).toEqual([]);
    // The opponent's standing center characters cannot be sent into an attack.
    for (const slot of [1, 2, 3] as const) {
      expect(attempt(s, attack(slot, 'frontal', 1))).toBe('NOT_YOUR_DECISION');
    }
  });

  it("[ATK-01] on player 1's turn it is player 1's characters that attack, and the damage goes to player 0", () => {
    // Player 1 is the turn player (the second player's first turn).
    const s0 = attackPhase({ stage: { 3: 'Y1', 1: 'Y2' } }, { stage: { 2: 'R1' } }, { active: 1, starting: 0, turn: 2 });
    expect(s0.pending).toEqual({ kind: 'attack', player: 1 });
    // Player 0's standing characters are not attackers on player 1's turn.
    expect(legalActions(s0, cat, 0)).toEqual([]);
    expect(attackChoices(s0)).toEqual(['2:direct']);

    const s1 = act(s0, cat, attack(2, 'direct', 1));
    const damage = eventsOf(since(s0, s1), 'damage');
    expect(damage).toHaveLength(1);
    expect(damage[0]).toMatchObject({ target: 0, amount: 2, source: cardIn(s0, 1, 'stage', 'R1') });
    expect(s1.players[0].clock).toHaveLength(2);
    expect(s1.players[1].clock).toHaveLength(0);
  });

  it('[ATK-02] a frontal Attack Sub-Phase runs Declaration, Trigger, Counter, Damage and Battle, then the end-of-attack timing, then a new declaration', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 2: 'R0' } });
    const attacker = idAt(s0, 0, 2);
    const defender = idAt(s0, 1, 2);
    expect(s0.attack).toBeNull();

    // In the middle of the sub-phase (the Counter Step) the attack states are in place.
    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(s1.step).toBe('counter');
    expect(s1.attack).toEqual({ type: 'frontal', attacker: { card: attacker, epoch: 0 }, slot: 2, facing: { card: defender, epoch: 0 }, facingSlot: 2 });

    // The sub-phase ends after the Battle Step; the next declaration step has no attack in progress.
    const s2 = act(s1, cat, pass(1));
    const all = since(s0, s2);
    expect(stepsIn(all)).toEqual(['trigger', 'counter', 'damage', 'battle', 'declaration']);
    const t = tags(all);
    expect(count(t, 'trigger:attackEnd')).toBe(1);
    expect(t.slice(t.indexOf('battle'))).toEqual([
      'battle',
      'orientation:reverse',
      'check',
      'trigger:attackEnd',
      'check',
      'step:declaration',
      'trigger:attackDeclarationStart',
      'check',
    ]);
    expect(s2.step).toBe('declaration');
    expect(s2.attack).toBeNull();
    expect(s2.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[ATK-02] without a battle (direct or side attack) the Attack Sub-Phase ends right after the Damage Step', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 2: 'R0' } });

    // Direct attack from position 1 (nothing faces it).
    const s1 = act(s0, cat, attack(1, 'direct'));
    const direct = since(s0, s1);
    expect(stepsIn(direct)).toEqual(['trigger', 'damage', 'declaration']);
    const td = tags(direct);
    expect(td.slice(td.indexOf('damageTaken'))).toEqual(['damageTaken', 'check', 'trigger:attackEnd', 'check', 'step:declaration', 'trigger:attackDeclarationStart', 'check']);
    expect(s1.attack).toBeNull();

    // Side attack from position 2: also no Counter or Battle Step.
    const s2 = act(s1, cat, attack(2, 'side'));
    const side = since(s1, s2);
    expect(stepsIn(side)).toEqual(['trigger', 'damage', 'declaration', 'encore']);
    const ts = tags(side);
    expect(count(ts, 'trigger:attackEnd')).toBe(1);
    expect(ts.slice(ts.indexOf('damageTaken'), ts.indexOf('step:declaration') + 1)).toEqual(['damageTaken', 'check', 'trigger:attackEnd', 'check', 'step:declaration']);
    expect(ts).not.toContain('battle');
  });

  it('[ATK-02] attack states last one sub-phase: in the next attack only the new attacker gains from a soul trigger', () => {
    // Deck top is the last entry: the first trigger check reveals G0, the second reveals the soul climax YX.
    // Y0b on position 2 keeps the phase going after the second attack.
    const s0 = attackPhase({ deck: [...PLAIN, 'YX', 'G0'], stage: { 1: 'Y1', 2: 'Y0b', 3: 'Y0' } });
    const first = idAt(s0, 0, 1);
    const second = idAt(s0, 0, 3);

    const s1 = act(s0, cat, attack(1, 'direct'));
    expect(s1.attack).toBeNull();
    const s2 = act(s1, cat, attack(3, 'direct'));
    const ev = since(s1, s2);

    // The soul icon goes to the attacker of this sub-phase, not to the earlier attacker.
    expect(eventsOf(ev, 'icon').map((e) => e.icon)).toEqual(['soul']);
    expect(eventsOf(ev, 'modifier').map((e) => [e.card, e.stat, e.amount])).toEqual([
      [second, 'soul', 1], // direct attack
      [second, 'soul', 1], // soul icon
    ]);
    expect(eventsOf(ev, 'damage').map((e) => [e.source, e.amount])).toEqual([[second, 3]]);
    // The first attacker keeps only its own direct-attack bonus.
    expect(currentSoul(s2, cat, first)).toBe(2);
  });
});

// =============================================================================
// ATK-03: trigger conditions at the start of the declaration step (CR 7.2.1.1-7.2.1.2)
// =============================================================================

describe('ATK: start of the Attack Declaration Step', () => {
  it('[ATK-03] the first declaration step meets "beginning of attack phase", a check timing, then "beginning of attack declaration step" and another check timing', () => {
    const s = attackPhase({ stage: { 1: 'Y1' } });
    expect(tags(s.log)).toEqual(['phase:attack', 'step:declaration', 'trigger:attackPhaseStart', 'check', 'trigger:attackDeclarationStart', 'check']);
    expect(s.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[ATK-03] the check timing after "beginning of attack phase" is a real one: a 0-power character is removed before the next trigger condition', () => {
    const s = attackPhase({ stage: { 1: 'Y1', 4: 'Z0' } });
    expect(tags(s.log)).toEqual([
      'phase:attack',
      'step:declaration',
      'trigger:attackPhaseStart',
      'check',
      'rule:insufficientPower',
      'move:ruleAction',
      'trigger:attackDeclarationStart',
      'check',
    ]);
  });

  it('[ATK-03] later declaration steps meet only the declaration-step condition; "beginning of attack phase" happens once per turn', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y0' } });
    const s1 = act(s0, cat, attack(1, 'direct'));
    const second = tags(since(s0, s1));
    expect(second.slice(-3)).toEqual(['step:declaration', 'trigger:attackDeclarationStart', 'check']);
    expect(second).not.toContain('trigger:attackPhaseStart');

    // The last declaration step (nobody left to attack) still meets its condition before the Encore Step.
    const s2 = act(s1, cat, attack(2, 'direct'));
    const third = tags(since(s1, s2));
    expectRun(third, ['step:declaration', 'trigger:attackDeclarationStart', 'check', 'step:encore']);
    expect(third).not.toContain('trigger:attackPhaseStart');

    const turn = tags(s2.log.filter((e) => e.turn === s0.turn));
    expect(count(turn, 'step:declaration')).toBe(3);
    expect(count(turn, 'trigger:attackDeclarationStart')).toBe(3);
    expect(count(turn, 'trigger:attackPhaseStart')).toBe(1);
    // Every declaration-step condition is followed at once by a check timing.
    turn.forEach((x, i) => {
      if (x === 'trigger:attackDeclarationStart') expect(turn[i + 1]).toBe('check');
    });
  });
});

// =============================================================================
// ATK-04 .. ATK-06: choosing an attacker or ending the phase (CR 7.2.1.3)
// =============================================================================

describe('ATK: choosing the attacker', () => {
  it('[ATK-04] only Stand State characters on the center stage can be chosen; rested, reversed and back-stage ones cannot', () => {
    const s = attackPhase({
      stage: { 1: 'Y1', 2: { def: 'Y1', orientation: 'rest' }, 3: { def: 'Y1', orientation: 'reverse' }, 4: 'Y1', 5: 'Y2' },
    });
    expect(attackChoices(s)).toEqual(['1:direct']);
    for (const slot of [2, 3, 4, 5] as const) {
      for (const type of ['direct', 'frontal', 'side'] as const) expect(attempt(s, attack(slot, type))).toBe('ILLEGAL_ACTION');
    }
    expect(attempt(s, attack(1, 'direct'))).toBe('ok');

    // Every standing center character qualifies, in any of the three positions.
    const all = attackPhase({ stage: { 1: 'Y1', 2: 'Y0', 3: 'Y2' } });
    expect(attackChoices(all)).toEqual(['1:direct', '2:direct', '3:direct']);
    // An empty position offers nothing.
    const gap = attackPhase({ stage: { 1: 'Y1', 3: 'Y2' } });
    expect(attackChoices(gap)).toEqual(['1:direct', '3:direct']);
  });

  it('[ATK-04] the chosen character becomes the attacker; the other standing characters are left alone', () => {
    // BX (draw icon) on top of the deck pauses the Trigger Step with a yes/no prompt.
    const s0 = attackPhase({ deck: [...PLAIN, 'BX'], stage: { 1: 'Y1', 2: 'Y2', 3: 'Y0' } });
    const chosen = idAt(s0, 0, 2);

    const s1 = act(s0, cat, attack(2, 'direct'));
    expect(s1.step).toBe('trigger');
    expect(s1.attack?.attacker).toEqual({ card: chosen, epoch: 0 });
    expect(s1.attack?.slot).toBe(2);
    expect(eventsOf(since(s0, s1), 'attack')).toMatchObject([{ player: 0, card: chosen, slot: 2, attack: 'direct' }]);
    expect(orientationOf(s1, chosen)).toBe('rest');
    expect(orientationOf(s1, idAt(s0, 0, 1))).toBe('stand');
    expect(orientationOf(s1, idAt(s0, 0, 3))).toBe('stand');

    const s2 = act(s1, cat, pass());
    expect(eventsOf(since(s1, s2), 'damage').map((e) => e.source)).toEqual([chosen]);
    // The rested attacker is no longer a candidate; the other two still are.
    expect(attackChoices(s2)).toEqual(['1:direct', '3:direct']);
  });

  it('[ATK-04] with no character able to attack, attacking is never offered and play moves on to the Encore Step', () => {
    const s = attackPhase(
      { stage: { 1: { def: 'Y1', orientation: 'rest' }, 2: { def: 'Y1', orientation: 'reverse' }, 4: 'Y1', 5: 'Y1' } },
      { stage: { 1: 'R1', 2: 'R1', 3: 'R1' } },
    );
    const t = tags(s.log);
    expect(t.slice(0, 7)).toEqual([
      'phase:attack',
      'step:declaration',
      'trigger:attackPhaseStart',
      'check',
      'trigger:attackDeclarationStart',
      'check',
      'step:encore',
    ]);
    // Nobody was asked anything during the declaration step, and no attack happened.
    expect(t).not.toContain('action:ATTACK');
    expect(eventsOf(s.log, 'attack')).toEqual([]);
    expect(eventsOf(s.log, 'action')).toEqual([]);
    expect(t).toContain('phase:end');
  });

  it('[ATK-04] after the last eligible character has attacked, the next declaration step offers no attack and the phase ends', () => {
    const s0 = attackPhase({ stage: { 2: 'Y1', 4: 'Y2' } });
    expect(attackChoices(s0)).toEqual(['2:direct']);
    const s1 = act(s0, cat, attack(2, 'direct'));
    const t = tags(since(s0, s1));
    expectRun(t, ['step:declaration', 'trigger:attackDeclarationStart', 'check', 'step:encore']);
    expect(count(t, 'attack:direct')).toBe(1);
    expect(s1.pending?.kind).not.toBe('attack');
  });

  it("[ATK-05] in the starting player's first turn, once one Attack Sub-Phase has happened, no second attacker can be chosen", () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y1', 3: 'Y1' } }, {}, { turn: 1, starting: 0 });
    // The first attack is unrestricted.
    expect(attackChoices(s0)).toEqual(['1:direct', '2:direct', '3:direct']);

    const s1 = act(s0, cat, attack(1, 'direct'));
    const t = tags(since(s0, s1));
    // The next declaration step happens, but goes straight to the Encore Step with two characters still standing.
    expectRun(t, ['step:declaration', 'trigger:attackDeclarationStart', 'check', 'step:encore']);
    expect(count(t, 'action:ATTACK')).toBe(1);
    expect(eventsOf(s1.log, 'attack')).toHaveLength(1);
    expect(orientationOf(s1, idAt(s0, 0, 2))).toBe('stand');
    expect(orientationOf(s1, idAt(s0, 0, 3))).toBe('stand');
    expect(s1.turn).toBe(2); // the turn has passed to player 1
  });

  it("[ATK-05] the one-attack limit does not apply to the second player's first turn or to later turns", () => {
    // The second player's first turn (turn 2, player 1 active, player 0 started).
    const p1 = attackPhase({}, { stage: { 1: 'R1', 2: 'R1', 3: 'R1' } }, { turn: 2, active: 1, starting: 0 });
    const p1a = act(p1, cat, attack(1, 'direct', 1));
    expect(p1a.pending).toEqual({ kind: 'attack', player: 1 });
    expect(attackChoices(p1a)).toEqual(['2:direct', '3:direct']);
    const p1b = act(p1a, cat, attack(2, 'direct', 1));
    expect(attackChoices(p1b)).toEqual(['3:direct']);

    // The starting player's second turn.
    const p0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y1', 3: 'Y1' } }, {}, { turn: 3, starting: 0 });
    const p0a = act(p0, cat, attack(3, 'direct'));
    expect(p0a.pending).toEqual({ kind: 'attack', player: 0 });
    expect(attackChoices(p0a)).toEqual(['1:direct', '2:direct']);
  });

  it('[ATK-06] PASS at the declaration step ends the Attack Phase and goes straight to the Encore Step', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } }, { stage: { 2: 'R0' } });
    // Ending the phase is on offer even while characters could attack.
    expect(legalActions(s0, cat)).toContainEqual(pass());

    const s1 = act(s0, cat, pass());
    const ev = since(s0, s1);
    const t = tags(ev);
    expect(t.slice(0, 4)).toEqual(['action:PASS', 'step:encore', 'trigger:encoreStepStart', 'check']);
    // No Trigger, Counter, Damage or Battle Step, and no end-of-attack timing.
    expect(stepsIn(ev)).toEqual(['encore']);
    expect(t).not.toContain('trigger:attackEnd');
    expect(t).not.toContain('trigger:triggerStepStart');
    expect(eventsOf(ev, 'attack')).toEqual([]);
    expect(eventsOf(ev, 'damage')).toEqual([]);
    // Nothing attacked, so nothing was rested.
    expect(orientationOf(s1, idAt(s0, 0, 1))).toBe('stand');
    expect(orientationOf(s1, idAt(s0, 0, 2))).toBe('stand');
    expect(s1.players[1].clock).toEqual([]);
    expect(eventsOf(ev, 'phase').map((e) => e.phase).slice(0, 1)).toEqual(['end']);
  });

  it('[ATK-06] ending the phase after an attack also goes straight to the Encore Step', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y2' } });
    const s1 = act(s0, cat, attack(1, 'direct'));
    expect(s1.pending).toEqual({ kind: 'attack', player: 0 });
    const s2 = act(s1, cat, pass());
    const ev = since(s1, s2);
    expect(tags(ev).slice(0, 2)).toEqual(['action:PASS', 'step:encore']);
    expect(stepsIn(ev)).toEqual(['encore']);
    expect(eventsOf(ev, 'attack')).toEqual([]);
    expect(orientationOf(s2, idAt(s0, 0, 2))).toBe('stand');
  });
});

// =============================================================================
// ATK-07 .. ATK-10: the attack type and its soul change (CR 7.2.1.4, 3.6.6)
// =============================================================================

describe('ATK: the type of attack', () => {
  it('[ATK-07] with no opposing character facing it, the attack can only be direct; back-stage characters face nobody', () => {
    // Facing pairs: my 1 <-> their 3, my 2 <-> their 2, my 3 <-> their 1.
    const s = attackPhase({ stage: { 1: 'Y1', 2: 'Y1', 3: 'Y1' } }, { stage: { 1: 'R1', 4: 'R0', 5: 'R0' } });
    expect(attackChoices(s)).toEqual(['1:direct', '2:direct', '3:frontal', '3:side']);
    for (const slot of [1, 2] as const) {
      expect(attempt(s, attack(slot, 'frontal'))).toBe('ILLEGAL_ACTION');
      expect(attempt(s, attack(slot, 'side'))).toBe('ILLEGAL_ACTION');
    }
  });

  it('[ATK-07] a direct attack gives the attacker +1 soul that lasts until end of turn, not just for the attack', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y0' } });
    const attacker = idAt(s0, 0, 1);
    expect(currentSoul(s0, cat, attacker)).toBe(1);

    const s1 = act(s0, cat, attack(1, 'direct'));
    const ev = since(s0, s1);
    expect(eventsOf(ev, 'modifier').map((e) => [e.card, e.stat, e.amount])).toEqual([[attacker, 'soul', 1]]);
    // Soul 1 + 1: two damage, all of it to the clock (no climax revealed).
    expect(eventsOf(ev, 'damage').map((e) => [e.target, e.source, e.amount])).toEqual([[1, attacker, 2]]);
    expect(s1.players[1].clock).toHaveLength(2);

    // The sub-phase is over but the bonus remains for the rest of the turn.
    expect(s1.attack).toBeNull();
    expect(currentSoul(s1, cat, attacker)).toBe(2);

    // It ends with the turn.
    const s2 = act(s1, cat, pass());
    const t = tags(since(s1, s2));
    expect(t.indexOf('effectsExpired')).toBeGreaterThan(t.indexOf('phase:end'));
    expect(t.indexOf('effectsExpired')).toBeLessThan(t.indexOf('turnStart'));
    expect(currentSoul(s2, cat, attacker)).toBe(1);
  });

  it('[ATK-08] a facing character, standing, rested or reversed, gives the turn player a choice of frontal or side, never direct', () => {
    const s = attackPhase(
      { stage: { 1: 'Y1', 2: 'Y1', 3: 'Y1' } },
      { stage: { 1: 'R1', 2: { def: 'R1', orientation: 'reverse' }, 3: { def: 'R1', orientation: 'rest' } } },
    );
    expect(attackChoices(s)).toEqual(['1:frontal', '1:side', '2:frontal', '2:side', '3:frontal', '3:side']);
    for (const slot of [1, 2, 3] as const) expect(attempt(s, attack(slot, 'direct'))).toBe('ILLEGAL_ACTION');
    // The choice is the turn player's alone.
    expect(legalActions(s, cat, 1)).toEqual([]);
  });

  it("[ATK-08] the turn player's pick decides the attack: frontal goes on to the Counter Step, side does not", () => {
    const s0 = attackPhase({ stage: { 2: 'Y2' } }, { stage: { 2: 'R0' } });

    const frontal = act(s0, cat, attack(2, 'frontal'));
    expect(frontal.attack?.type).toBe('frontal');
    expect(frontal.step).toBe('counter');
    expect(frontal.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(eventsOf(since(s0, frontal), 'modifier')).toEqual([]);

    const side = act(s0, cat, attack(2, 'side'));
    const ev = since(s0, side);
    expect(eventsOf(ev, 'attack').map((e) => e.attack)).toEqual(['side']);
    expect(stepsIn(ev)).not.toContain('counter');
    expect(stepsIn(ev).slice(0, 2)).toEqual(['trigger', 'damage']);
  });

  it('[ATK-09] a side attack gives the attacker -X soul until end of turn, X being the level of the facing character', () => {
    // Y0 on position 1 keeps the phase going after the first attack.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'HV' } }, { stage: { 2: 'Y2' } });
    const attacker = idAt(s0, 0, 2);

    const s1 = act(s0, cat, attack(2, 'side'));
    const ev = since(s0, s1);
    expect(eventsOf(ev, 'modifier').map((e) => [e.card, e.stat, e.amount])).toEqual([[attacker, 'soul', -2]]);
    // Soul 4 - 2: two damage.
    expect(eventsOf(ev, 'damage').map((e) => e.amount)).toEqual([2]);
    expect(s1.players[1].clock).toHaveLength(2);
    // Still lowered after the sub-phase, back to normal after the turn.
    expect(currentSoul(s1, cat, attacker)).toBe(2);
    const s2 = act(s1, cat, pass());
    expect(currentSoul(s2, cat, attacker)).toBe(4);
  });

  it('[ATK-09] a level 0 facing character costs the side attacker no soul, and a frontal attack costs none at any level', () => {
    // Y0 on position 1 keeps the phase going after the side attack.
    const lvl0 = attackPhase({ stage: { 1: 'Y0', 2: 'HV' } }, { stage: { 2: 'R0' } });
    const a0 = idAt(lvl0, 0, 2);
    const side0 = act(lvl0, cat, attack(2, 'side'));
    const ev0 = since(lvl0, side0);
    expect(eventsOf(ev0, 'attack').map((e) => [e.attack, e.facing])).toEqual([['side', idAt(lvl0, 1, 2)]]);
    expect(eventsOf(ev0, 'modifier')).toEqual([]);
    expect(eventsOf(ev0, 'damage').map((e) => e.amount)).toEqual([4]);
    expect(side0.pending).toEqual({ kind: 'attack', player: 0 });
    expect(currentSoul(side0, cat, a0)).toBe(4);

    const lvl2 = attackPhase({ stage: { 2: 'HV' } }, { stage: { 2: 'Y2' } });
    const a2 = idAt(lvl2, 0, 2);
    const frontal = act(lvl2, cat, attack(2, 'frontal'));
    expect(eventsOf(since(lvl2, frontal), 'modifier')).toEqual([]);
    expect(currentSoul(frontal, cat, a2)).toBe(4);
  });

  it('[ATK-09] the full level is taken even if it drives soul to 0 or below, and then no damage is dealt', () => {
    const s0 = attackPhase({ stage: { 2: 'Y1', 1: 'Y0' } }, { stage: { 2: 'R3' } });
    const attacker = idAt(s0, 0, 2);
    const s1 = act(s0, cat, attack(2, 'side'));
    const ev = since(s0, s1);
    expect(eventsOf(ev, 'modifier').map((e) => [e.card, e.stat, e.amount])).toEqual([[attacker, 'soul', -3]]);
    expect(currentSoul(s1, cat, attacker)).toBe(-2);
    expect(eventsOf(ev, 'damage')).toEqual([]);
    expect(s1.players[1].clock).toEqual([]);
  });

  it('[ATK-10] a side attack stays a side attack, keeping its soul penalty, after the facing character is returned to hand', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'XR'], stage: { 1: 'Y0', 2: 'HV' } }, { stage: { 2: 'Y2' } });
    const attacker = idAt(s0, 0, 2);
    const facingCard = idAt(s0, 1, 2);

    const s1 = act(s0, cat, attack(2, 'side'));
    expect(s1.pending).toEqual({ kind: 'choose', player: 0, reason: 'return', options: [facingCard], optional: true });
    const s2 = act(s1, cat, { type: 'CHOOSE_CARD', player: 0, card: facingCard });
    expect(s2.players[1].hand).toContain(facingCard);

    const ev = since(s1, s2);
    // Still a side attack: no Counter Step, no direct-attack bonus, and the -2 is not undone.
    expect(stepsIn(ev)).toEqual(['damage', 'declaration']);
    expect(eventsOf(ev, 'modifier')).toEqual([]);
    expect(eventsOf(ev, 'damage').map((e) => [e.source, e.amount])).toEqual([[attacker, 2]]);
    expect(eventsOf(s2.log, 'attack').map((e) => e.attack)).toEqual(['side']);
    expect(currentSoul(s2, cat, attacker)).toBe(2);
  });

  it('[ATK-10] a frontal attack stays frontal after the facing character is returned to hand: Counter and Battle Steps still come', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'XR'], stage: { 2: 'Y1' } }, { stage: { 2: 'Y2' } });
    const attacker = idAt(s0, 0, 2);
    const facingCard = idAt(s0, 1, 2);

    const s1 = act(s0, cat, attack(2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: facingCard });
    expect(s1.step).toBe('counter');
    expect(s1.attack?.type).toBe('frontal');
    expect(s1.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    const s2 = act(s1, cat, pass(1));
    const all = since(s0, s2);
    expect(stepsIn(all)).toEqual(['trigger', 'counter', 'damage', 'battle', 'declaration', 'encore']);
    // It did not turn into a direct attack: no +1 soul, damage equal to the printed soul.
    expect(eventsOf(all, 'modifier')).toEqual([]);
    expect(eventsOf(all, 'damage').map((e) => [e.source, e.amount])).toEqual([[attacker, 1]]);
    // Nothing to battle with, so the weaker attacker is not reversed.
    expect(eventsOf(all, 'battle')).toEqual([]);
    expect(eventsOf(all, 'orientation').filter((e) => e.orientation === 'reverse')).toEqual([]);
  });

  it('[ATK-10] a direct attack stays direct, keeping its +1 soul, even if a character turns up facing the attacker mid-attack', () => {
    // BX (draw icon) pauses the Trigger Step with a yes/no prompt.
    const s0 = attackPhase({ deck: [...PLAIN, 'BX'], stage: { 1: 'Y1' } }, { hand: ['R1'] });
    const attacker = idAt(s0, 0, 1);
    const s1 = act(s0, cat, attack(1, 'direct'));
    expect(s1.pending).toEqual({ kind: 'confirm', player: 0, reason: 'draw' });

    // An effect (simulated) puts a character on the position facing the attacker.
    const s2 = ops.deepClone(s1);
    const newcomer = cardIn(s2, 1, 'hand', 'R1');
    ops.moveCard(s2, newcomer, { player: 1, zone: 'stage', slot: 3 }, 'effect');

    const s3 = act(s2, cat, pass());
    const ev = since(s2, s3);
    expect(stepsIn(ev)).not.toContain('counter');
    expect(stepsIn(ev)).not.toContain('battle');
    expect(eventsOf(ev, 'modifier')).toEqual([]);
    expect(eventsOf(ev, 'damage').map((e) => [e.source, e.amount])).toEqual([[attacker, 2]]);
    expect(orientationOf(s3, newcomer)).toBe('stand');
  });
});

// =============================================================================
// ATK-11 .. ATK-14: attack states and resting the attacker (CR 7.2.1.5-7.2.1.6)
// =============================================================================

describe('ATK: attack states', () => {
  it('[ATK-11] the declared character is the attacking character through the sub-phase: a soul trigger goes to it and it deals the damage', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'YX'], stage: { 2: 'Y1' } }, { stage: { 2: 'R0' } });
    const attacker = idAt(s0, 0, 2);

    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(s1.attack?.attacker).toEqual({ card: attacker, epoch: 0 });
    expect(eventsOf(since(s0, s1), 'modifier').map((e) => [e.card, e.stat, e.amount])).toEqual([[attacker, 'soul', 1]]);
    expect(currentSoul(s1, cat, attacker)).toBe(2);

    const s2 = act(s1, cat, pass(1));
    const ev = since(s1, s2);
    expect(eventsOf(ev, 'damage').map((e) => [e.source, e.amount])).toEqual([[attacker, 2]]);
    expect(eventsOf(ev, 'battle').map((e) => e.attacker)).toEqual([attacker]);
  });

  it('[ATK-11] an attacker that leaves the stage stops being the attacking character; the character now on its position does not take over', () => {
    // Standby icon: put Y0 from the waiting room onto the attacker's position. The attacker,
    // placed earlier, then goes to the waiting room by rule action (CR 9.6).
    const s0 = attackPhase({ deck: [...PLAIN, 'XS'], waiting: ['Y0'], stage: { 2: 'Y1' } }, { stage: { 2: 'R0' } });
    const attacker = idAt(s0, 0, 2);
    const recruit = cardIn(s0, 0, 'waiting', 'Y0');

    const s1 = act(
      s0,
      cat,
      attack(2, 'frontal'),
      { type: 'CHOOSE_CARD', player: 0, card: recruit },
      { type: 'CHOOSE_SLOT', player: 0, slot: 2 },
    );
    expect(s1.step).toBe('counter');
    expect(s1.players[0].waiting).toContain(attacker);
    expect(idAt(s1, 0, 2)).toBe(recruit);

    const s2 = act(s1, cat, pass(1));
    const ev = since(s1, s2);
    // No attacking character: no damage and no battle, though the sub-phase still runs to its end.
    expect(stepsIn(ev)).toEqual(['damage', 'battle', 'declaration', 'encore']);
    expect(eventsOf(ev, 'damage')).toEqual([]);
    expect(eventsOf(ev, 'battle')).toEqual([]);
    expect(tags(ev)).toContain('trigger:attackEnd');
    expect(s2.players[1].clock).toEqual([]);
    expect(orientationOf(s2, idAt(s0, 1, 2))).toBe('stand');
  });

  it('[ATK-11] moving the attacker to another stage position also ends its attacking status, even though it stays the same card object', () => {
    const s0 = attackPhase({ stage: { 2: 'Y2' } }, { stage: { 2: 'R0' } });
    const attacker = idAt(s0, 0, 2);
    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(s1.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    // An effect (simulated) moves the attacker from position 2 to position 5.
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, attacker, { player: 0, zone: 'stage', slot: 5 }, 'effect');
    expect(s2.cards[attacker]?.epoch).toBe(s1.cards[attacker]?.epoch);

    const s3 = act(s2, cat, pass(1));
    const ev = since(s2, s3);
    expect(eventsOf(ev, 'damage')).toEqual([]);
    expect(eventsOf(ev, 'battle')).toEqual([]);
    expect(s3.players[1].clock).toEqual([]);
    // The weaker defender was not reversed.
    expect(orientationOf(s3, idAt(s0, 1, 2))).toBe('stand');
    expect(slotOf(s3, attacker)).toBe(5);
  });

  it('[ATK-11] an attacker that leaves the stage and is put back on the same position is a new card, not the attacking character', () => {
    const s0 = attackPhase({ stage: { 2: 'Y2' } }, { stage: { 2: 'R0' } });
    const attacker = idAt(s0, 0, 2); // 7000
    const defender = idAt(s0, 1, 2); // 3000
    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(s1.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    // Effects (simulated) return the attacker to its owner's hand and then put it back on position 2.
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, attacker, { player: 0, zone: 'hand' }, 'effect');
    ops.moveCard(s2, attacker, { player: 0, zone: 'stage', slot: 2 }, 'effect');
    expect(idAt(s2, 0, 2)).toBe(attacker);
    expect(s2.cards[attacker]?.epoch).not.toBe(s1.attack?.attacker.epoch);

    const s3 = act(s2, cat, pass(1));
    const ev = since(s2, s3);
    // Same card, same position, but a new object: it deals no damage and does not battle.
    expect(eventsOf(ev, 'damage')).toEqual([]);
    expect(eventsOf(ev, 'battle')).toEqual([]);
    expect(s3.players[1].clock).toEqual([]);
    expect(orientationOf(s3, defender)).toBe('stand');
    // It came back standing and has not attacked as this object, so it may be chosen again.
    expect(attackChoices(s3)).toEqual(['2:frontal', '2:side']);
  });

  it('[ATK-12] in a frontal attack the facing character is the defending character: Backup targets it and it battles the attacker', () => {
    // Y0 on position 1 keeps the phase going after this attack, so the battle result can be seen.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RB'], stock: ['G0'] });
    const attacker = idAt(s0, 0, 2); // 7000
    const defender = idAt(s0, 1, 2); // 4500
    const backup = cardIn(s0, 1, 'hand', 'RB');

    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(canBackup(s1, cat, 1, backup)).toBe(true);
    expect(legalActions(s1, cat)).toContainEqual({ type: 'BACKUP', player: 1, card: backup });

    // Without Backup: the two battle each other, and the weaker defender is reversed.
    const plain = act(s1, cat, pass(1));
    expect(eventsOf(since(s1, plain), 'battle')).toEqual([expect.objectContaining({ attacker, defender, reversed: [defender] })]);
    expect(orientationOf(plain, defender)).toBe('reverse');
    expect(orientationOf(plain, attacker)).toBe('rest');

    // With Backup: the power goes to the defender (4500 + 3000 > 7000), and the attacker loses the battle.
    const backed = act(s1, cat, { type: 'BACKUP', player: 1, card: backup });
    const ev = since(s1, backed);
    expect(eventsOf(ev, 'backup').map((e) => e.target)).toEqual([defender]);
    expect(eventsOf(ev, 'battle')).toEqual([expect.objectContaining({ attacker, defender, reversed: [attacker] })]);
    expect(orientationOf(backed, attacker)).toBe('reverse');
    expect(orientationOf(backed, defender)).toBe('stand');
  });

  it('[ATK-12] a facing character returned to hand stops being the defending character: Backup has no target and nothing battles', () => {
    const s0 = attackPhase({ deck: [...PLAIN, 'XR'], stage: { 2: 'Y1' } }, { stage: { 2: 'Y2' }, hand: ['RB'], stock: ['G0'] });
    const attacker = idAt(s0, 0, 2);
    const defender = idAt(s0, 1, 2);
    const backup = cardIn(s0, 1, 'hand', 'RB');

    const s1 = act(s0, cat, attack(2, 'frontal'), { type: 'CHOOSE_CARD', player: 0, card: defender });
    expect(s1.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(canBackup(s1, cat, 1, backup)).toBe(false);
    expect(legalActions(s1, cat).map((a) => a.type)).not.toContain('BACKUP');

    const s2 = act(s1, cat, pass(1));
    expect(eventsOf(since(s1, s2), 'battle')).toEqual([]);
    expect(orientationOf(s2, attacker)).toBe('rest');
  });

  it('[ATK-12] a defending character moved to another stage position stops defending and does not battle', () => {
    const s0 = attackPhase({ stage: { 2: 'Y1' } }, { stage: { 2: 'Y2' }, hand: ['RB'], stock: ['G0'] });
    const attacker = idAt(s0, 0, 2); // 5000
    const defender = idAt(s0, 1, 2); // 7000
    const backup = cardIn(s0, 1, 'hand', 'RB');
    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(canBackup(s1, cat, 1, backup)).toBe(true);

    // An effect (simulated) moves the defender from position 2 to position 4.
    const s2 = ops.deepClone(s1);
    ops.moveCard(s2, defender, { player: 1, zone: 'stage', slot: 4 }, 'effect');
    expect(canBackup(s2, cat, 1, backup)).toBe(false);

    const s3 = act(s2, cat, pass(1));
    expect(eventsOf(since(s2, s3), 'battle')).toEqual([]);
    expect(orientationOf(s3, attacker)).toBe('rest');
    expect(orientationOf(s3, defender)).toBe('stand');
  });

  it('[ATK-12] the defending character is the card object chosen at declaration: a newcomer on its position, or the defender put back there, does not defend', () => {
    const s0 = attackPhase({ stage: { 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['R0', 'RB'], stock: ['G0'] });
    const defender = idAt(s0, 1, 2); // 4500, against an attacker of 7000
    const backup = cardIn(s0, 1, 'hand', 'RB');
    const s1 = act(s0, cat, attack(2, 'frontal'));
    expect(canBackup(s1, cat, 1, backup)).toBe(true);

    // (a) The defender is returned to hand and another character is put on its position (simulated effects).
    const swapped = ops.deepClone(s1);
    const newcomer = cardIn(swapped, 1, 'hand', 'R0'); // 3000
    ops.moveCard(swapped, defender, { player: 1, zone: 'hand' }, 'effect');
    ops.moveCard(swapped, newcomer, { player: 1, zone: 'stage', slot: 2 }, 'effect');
    expect(canBackup(swapped, cat, 1, backup)).toBe(false);
    expect(legalActions(swapped, cat).map((a) => a.type)).not.toContain('BACKUP');
    const a = act(swapped, cat, pass(1));
    expect(eventsOf(since(swapped, a), 'battle')).toEqual([]);
    expect(orientationOf(a, newcomer)).toBe('stand');

    // (b) The defender is returned to hand and put back on the same position: a new object, not the defender.
    const back = ops.deepClone(s1);
    ops.moveCard(back, defender, { player: 1, zone: 'hand' }, 'effect');
    ops.moveCard(back, defender, { player: 1, zone: 'stage', slot: 2 }, 'effect');
    expect(idAt(back, 1, 2)).toBe(defender);
    expect(canBackup(back, cat, 1, backup)).toBe(false);
    const b = act(back, cat, pass(1));
    expect(eventsOf(since(back, b), 'battle')).toEqual([]);
    expect(orientationOf(b, defender)).toBe('stand');
  });

  it('[ATK-13] in a frontal or side attack the character facing the attacker is the one being attacked; a direct attack has none', () => {
    // My 3 faces their 1 (R0), my 2 faces their 2 (R1), my 1 faces their empty 3.
    const s0 = attackPhase({ deck: [...PLAIN, 'BX'], stage: { 1: 'Y1', 2: 'Y1', 3: 'Y1' } }, { stage: { 1: 'R0', 2: 'R1' } });
    const r0 = idAt(s0, 1, 1);
    const r1 = idAt(s0, 1, 2);

    const side = act(s0, cat, attack(3, 'side')); // paused on the draw icon
    expect(side.attack).toMatchObject({ type: 'side', slot: 3, facing: { card: r0, epoch: 0 }, facingSlot: 1 });
    expect(projectView(side, 1).attack).toEqual(side.attack);
    expect(eventsOf(since(s0, side), 'attack').map((e) => e.facing)).toEqual([r0]);

    const frontal = act(s0, cat, attack(2, 'frontal'), pass()); // decline the draw, go on to the Counter Step
    expect(frontal.step).toBe('counter');
    expect(frontal.attack).toMatchObject({ type: 'frontal', slot: 2, facing: { card: r1, epoch: 0 }, facingSlot: 2 });

    const direct = act(s0, cat, attack(1, 'direct'));
    expect(direct.attack).toMatchObject({ type: 'direct', slot: 1, facing: null, facingSlot: null });
    expect(eventsOf(since(s0, direct), 'attack').map((e) => e.facing)).toEqual([null]);
  });

  it('[ATK-13] a side-attacked character is being attacked but is not defending and not in battle: no Counter Step, no Backup, no reversal', () => {
    const s0 = attackPhase({ stage: { 2: 'Y2' } }, { stage: { 2: 'R1' }, hand: ['RB'], stock: ['G0'] });
    const attacker = idAt(s0, 0, 2); // 7000
    const target = idAt(s0, 1, 2); // 4500
    const s1 = act(s0, cat, attack(2, 'side'));
    const ev = since(s0, s1);
    expect(eventsOf(ev, 'attack').map((e) => [e.attack, e.facing])).toEqual([['side', target]]);
    expect(stepsIn(ev)).not.toContain('counter');
    expect(stepsIn(ev)).not.toContain('battle');
    expect(eventsOf(ev, 'playTiming')).toEqual([]);
    expect(eventsOf(ev, 'backup')).toEqual([]);
    expect(eventsOf(ev, 'battle')).toEqual([]);
    expect(orientationOf(s1, target)).toBe('stand');
    expect(orientationOf(s1, attacker)).toBe('rest');
    expect(s1.players[1].hand).toContain(cardIn(s0, 1, 'hand', 'RB'));
  });

  it('[ATK-14] the attack is set, then the attacker is rested, then a check timing, then the Trigger Step', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'HV', 3: 'Y2' } }, { stage: { 1: 'R0', 2: 'Y2' } });
    // Direct from 1 (their 3 is empty).
    const d = act(s0, cat, attack(1, 'direct'));
    const dt = tags(since(s0, d));
    expect(dt.slice(0, 7)).toEqual(['action:ATTACK', 'attack:direct', 'modifier:soul+1', 'orientation:rest', 'check', 'step:trigger', 'trigger:triggerStepStart']);
    expect(eventsOf(since(s0, d), 'orientation')[0]).toMatchObject({ card: idAt(s0, 0, 1), orientation: 'rest' });

    // Side from 2 (facing a level 2 character).
    const sd = act(s0, cat, attack(2, 'side'));
    expect(tags(since(s0, sd)).slice(0, 6)).toEqual(['action:ATTACK', 'attack:side', 'modifier:soul-2', 'orientation:rest', 'check', 'step:trigger']);

    // Frontal from 3 (facing R0).
    const f = act(s0, cat, attack(3, 'frontal'));
    expect(tags(since(s0, f)).slice(0, 5)).toEqual(['action:ATTACK', 'attack:frontal', 'orientation:rest', 'check', 'step:trigger']);
    expect(orientationOf(f, idAt(s0, 0, 3))).toBe('rest');
    // Only the attacker is rested.
    expect(orientationOf(f, idAt(s0, 0, 1))).toBe('stand');
    expect(orientationOf(f, idAt(s0, 0, 2))).toBe('stand');
  });

  it('[ATK-14] that check timing is fully resolved, rule actions and automatic abilities included, before the Trigger Step starts', () => {
    const s0 = attackPhase({ hand: ['Z0'], stage: { 1: 'Y1' } });
    // A 0-power character appears on the back stage (simulated effect) just before the attack.
    const prepped = ops.deepClone(s0);
    ops.moveCard(prepped, cardIn(prepped, 0, 'hand', 'Z0'), { player: 0, zone: 'stage', slot: 4 }, 'effect');

    const s1 = act(prepped, cat, attack(1, 'direct'));
    expect(tags(since(prepped, s1)).slice(0, 8)).toEqual([
      'action:ATTACK',
      'attack:direct',
      'modifier:soul+1',
      'orientation:rest',
      'check',
      'rule:insufficientPower',
      'move:ruleAction',
      'step:trigger',
    ]);

    // With 3 stock, the removed character's Encore is played inside that check timing, still in the declaration step.
    const rich = attackPhase({ hand: ['Z0'], stock: ['G0', 'G0', 'G0'], stage: { 1: 'Y1' } });
    const prepped2 = ops.deepClone(rich);
    const drone = cardIn(prepped2, 0, 'hand', 'Z0');
    ops.moveCard(prepped2, drone, { player: 0, zone: 'stage', slot: 4 }, 'effect');
    const e1 = act(prepped2, cat, attack(1, 'direct'));
    expect(e1.pending).toEqual({ kind: 'encore', player: 0, card: drone, slot: 4, cost: 3 });
    expect(e1.step).toBe('declaration');
    expect(stepsIn(since(prepped2, e1))).toEqual([]);

    const e2 = act(e1, cat, pass());
    expect(stepsIn(since(e1, e2))[0]).toBe('trigger');
  });
});
