// Rule tests for M3: activated abilities in the main phase (CR 6.5.1.2.3) and in
// the Counter Step (CR 7.4.1.2), who is master of an activated ability
// (CR 4.3.4), and ability costs (CR 8.4, with the play procedure of 8.6.2).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentPower, legalActions, validate, validateCatalog } from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CardId, CostPart, GameEvent, GameState, PlayerId, Slot } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

/** A level 0 yellow character with the given abilities. */
const char = (id: string, name: string, abilities: Ability[], more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 2000,
  soul: 1,
  abilities,
  ...more,
});

const stock = (count: number) => ({ pay: 'stock', count }) as const;
const drawOne = { do: 'draw', count: 1 } as const;
const pumpSelf = (amount: number) => ({ do: 'power', amount, target: 'this' }) as const;

const extra: CardDef[] = [
  // [ACT] [(1)] Draw a card.
  char('SIG', 'Signal Keeper', [{ kind: 'activated', timing: 'main', cost: [stock(1)], effect: [drawOne] }]),
  // Four abilities: a continuous one, a counter one, a main one usable only at level 1 or higher, and a plain main one.
  char('TAC', 'Dawn Tactician', [
    { kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: 'this' }] },
    { kind: 'activated', timing: 'counter', cost: [stock(1)], effect: [pumpSelf(1000)] },
    { kind: 'activated', timing: 'main', when: [{ if: 'level', min: 1 }], cost: [stock(1)], effect: [drawOne] },
    { kind: 'activated', timing: 'main', cost: [stock(1)], effect: [pumpSelf(1000)] },
  ]),
  // Costs with three parts, written in two different orders.
  char('CUR', 'Lantern Courier', [{ kind: 'activated', timing: 'main', cost: [stock(1), { pay: 'discard', count: 1 }, { pay: 'rest' }], effect: [pumpSelf(1500)] }]),
  char('POR', 'Lantern Porter', [{ kind: 'activated', timing: 'main', cost: [{ pay: 'rest' }, { pay: 'discard', count: 1 }, stock(1)], effect: [pumpSelf(1500)] }]),
  // A cost that puts the card itself into the waiting room.
  char('DEC', 'Paper Decoy', [{ kind: 'activated', timing: 'main', cost: [stock(1), { pay: 'selfToWaiting' }], effect: [drawOne] }]),
  // Two stock parts: each alone could be paid from 2 stock, both together cannot.
  char('TWN', 'Twin Ledger', [{ kind: 'activated', timing: 'main', cost: [stock(2), stock(1)], effect: [drawOne] }]),
  // Stock plus two hand cards.
  char('BAN', 'Hollow Banner', [{ kind: 'activated', timing: 'main', cost: [stock(1), { pay: 'discard', count: 2 }], effect: [drawOne] }]),
  // Rest first, then two stock.
  char('GAT', 'Gate Warden', [{ kind: 'activated', timing: 'main', cost: [{ pay: 'rest' }, stock(2)], effect: [drawOne] }]),
  // A blue hand card only.
  char('TID', 'Tide Scholar', [{ kind: 'activated', timing: 'main', cost: [{ pay: 'discard', count: 1, filter: { color: 'blue' } }], effect: [drawOne] }]),
  // [ACT] [(2)] This card gets +2000 power.
  char('TOL', 'Toll Keeper', [{ kind: 'activated', timing: 'main', cost: [stock(2)], effect: [pumpSelf(2000)] }]),
  // [AUTO] [Discard a card, (1)] When this is played, you may pay the cost. If you do, draw a card.
  char('HER', 'Harbor Herald', [{ kind: 'automatic', trigger: { on: 'play' }, cost: [{ pay: 'discard', count: 1 }, stock(1)], effect: [drawOne] }]),
  // "You" and "your opponent" in one effect: +1000 to one of your other characters, -1000 to each of the opponent's, and the opponent draws.
  char(
    'ARB',
    'Field Arbiter',
    [
      {
        kind: 'activated',
        timing: 'main',
        cost: [stock(1)],
        effect: [
          { do: 'choose', as: 'ally', count: 1, what: { side: 'you', other: true } },
          { do: 'power', amount: 1000, target: { ref: 'ally' } },
          { do: 'power', amount: -1000, target: { all: { side: 'opponent' } } },
          { do: 'draw', count: 1, player: 'opponent' },
        ],
      },
    ],
    { power: 3000 },
  ),
  // [COUNTER] [ACT] [(1)] Use only during your opponent's turn. Draw a card. Your defending character gets +2000
  // power and your opponent's attacking character gets -1000 power. Plus a main ability that the Counter Step does not allow.
  char(
    'SEN',
    'Watch Sentinel',
    [
      {
        kind: 'activated',
        timing: 'counter',
        when: [{ if: 'turn', side: 'opponent' }],
        cost: [stock(1)],
        effect: [
          drawOne,
          { do: 'power', amount: 2000, target: { all: { side: 'you', role: 'defender' } } },
          { do: 'power', amount: -1000, target: { all: { side: 'opponent', role: 'attacker' } } },
        ],
      },
      { kind: 'activated', timing: 'main', cost: [stock(1)], effect: [drawOne] },
    ],
    { color: 'red' },
  ),
  // [COUNTER] [ACT] [(1)] Choose 1 of your characters. It gets +1500 power.
  char(
    'RAL',
    'Rally Herald',
    [
      {
        kind: 'activated',
        timing: 'counter',
        cost: [stock(1)],
        effect: [
          { do: 'choose', as: 'mate', count: 1, what: { side: 'you' } },
          { do: 'power', amount: 1500, target: { ref: 'mate' } },
        ],
      },
    ],
    { color: 'red' },
  ),
  // [COUNTER] [ACT] [(2)] This card gets +2000 power.
  char('BUL', 'Bulwark Herald', [{ kind: 'activated', timing: 'counter', cost: [stock(2)], effect: [pumpSelf(2000)] }], { color: 'red' }),
  // [COUNTER] [ACT] [Discard a card from your hand] This card gets +1000 power.
  char('MIR', 'Mirror Guard', [{ kind: 'activated', timing: 'counter', cost: [{ pay: 'discard', count: 1 }], effect: [pumpSelf(1000)] }], { color: 'red' }),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons: trigger checks do nothing and damage always sticks. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

/** Starts at the Main Phase (player 0's turn). */
function mainPhase(p0: ZoneSpec, p1: ZoneSpec = {}): GameState {
  return makeState(cat, { start: 'main', players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }] });
}

/** Starts at the Attack Phase of `active`'s turn; `zones` are indexed by player. */
function attackPhase(active: PlayerId, zones: Record<PlayerId, ZoneSpec>, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start: 'attack', active, players: [{ deck: PLAIN, ...zones[0] }, { deck: PLAIN, ...zones[1] }], ...more });
}

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });
const activate = (player: PlayerId, card: CardId, ability: number): Action => ({ type: 'ACTIVATE', player, card, ability });

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

function orientationOf(s: GameState, card: CardId): string {
  for (const p of s.players) for (const cards of p.stage) for (const c of cards) if (c.id === card) return c.orientation;
  return 'not on stage';
}

/** Activated abilities offered to the player being waited on, as "DEF#index", sorted. */
function activations(s: GameState): string[] {
  return legalActions(s, cat)
    .flatMap((a) => (a.type === 'ACTIVATE' ? [`${defOf(s, a.card)}#${a.ability}`] : []))
    .sort();
}

/** Every legal action for the player being waited on, readable and sorted. */
function offers(s: GameState): string[] {
  return legalActions(s, cat)
    .map((a) => (a.type === 'ACTIVATE' ? `ACTIVATE:${defOf(s, a.card)}#${a.ability}` : 'card' in a && typeof a.card === 'string' ? `${a.type}:${defOf(s, a.card)}` : a.type))
    .filter((x, i, all) => all.indexOf(x) === i)
    .sort();
}

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.player}.${e.from.zone}->${e.to.player}.${e.to.zone}`];
    if (e.kind === 'orientation') return [`orient:${defOf(s, e.card)}:${e.orientation}`];
    if (e.kind === 'ability') return [`ability:${e.player}:${defOf(s, e.card)}#${String(e.index)}:${e.category}`];
    if (e.kind === 'abilityLapsed') return [`lapsed:${e.player}:${defOf(s, e.card)}#${e.index}`];
    if (e.kind === 'effect') return [`effect:${e.player}:${e.op}`];
    if (e.kind === 'modifier') return [`mod:${defOf(s, e.card)}:${e.stat}${e.amount > 0 ? '+' : ''}${e.amount}`];
    if (e.kind === 'optional') return [`optional:${e.player}:${e.purpose}:${e.accepted}`];
    if (e.kind === 'chosen') return [`chosen:${e.player}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'played') return [`played:${defOf(s, e.card)}`];
    if (e.kind === 'phase') return [`phase:${e.phase}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'auto') return [`auto:${e.ability}:${defOf(s, e.card)}`];
    return [];
  });
}

/** The trace up to and including the first `marker`. */
function upTo(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(0, i + 1);
}

const costMoves = (events: readonly GameEvent[]) => events.filter((e) => e.kind === 'move' && e.reason === 'cost');

describe('the synthetic catalog', () => {
  it('passes catalog validation', () => {
    expect(validateCatalog(cat)).toEqual([]);
  });
});

// =============================================================================
// MAIN-04: activated abilities in the main phase play timing (CR 6.5.1.2.3)
// =============================================================================

describe('MAIN-04: the turn player may use their valid activated abilities in the main phase', () => {
  it('[MAIN-04] the main play timing offers each valid activated ability of the turn player\'s stage characters, by card and ability index, next to PASS; no other ability is offered', () => {
    // TAC on center stage, SIG rested on back stage. Copies sit in hand and the waiting room; the opponent has its own SIG.
    const s = mainPhase({ stage: { 1: 'TAC', 4: { def: 'SIG', orientation: 'rest' } }, stock: ['G0', 'G0'], hand: ['TAC'], waiting: ['SIG'] }, { stage: { 2: 'SIG' }, stock: ['R0', 'R0'] });
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    const tac = idAt(s, 0, 1);
    const sig = idAt(s, 0, 4);

    // Level 0: TAC's plain main ability (index 3), its counter ability (index 1: a counter-icon ability may also be used in
    // its owner's own main phase, CR 2.8.2.1) and SIG's ability qualify. A rested character may still use a cost that does
    // not rest it, and back stage counts as the stage.
    expect(activations(s)).toEqual(['SIG#0', 'TAC#1', 'TAC#3']);
    expect(legalActions(s, cat)).toContainEqual(activate(0, tac, 3));
    expect(legalActions(s, cat)).toContainEqual(activate(0, sig, 0));
    expect(legalActions(s, cat)).toContainEqual(pass(0));

    expect(legalActions(s, cat)).toContainEqual(activate(0, tac, 1));
    // Not valid now: a continuous ability (never played), an ability whose condition fails,
    // an index the card does not have, abilities of cards in hand or the waiting room, and the opponent's character.
    expect(attempt(s, activate(0, tac, 0))).toBe('ILLEGAL_ACTION');
    expect(attempt(s, activate(0, tac, 2))).toBe('ILLEGAL_ACTION');
    expect(attempt(s, activate(0, tac, 4))).toBe('ILLEGAL_ACTION');
    expect(attempt(s, activate(0, cardIn(s, 0, 'hand', 'TAC'), 3))).toBe('ILLEGAL_ACTION');
    expect(attempt(s, activate(0, cardIn(s, 0, 'waiting', 'SIG'), 0))).toBe('ILLEGAL_ACTION');
    expect(attempt(s, activate(0, idAt(s, 1, 2), 0))).toBe('ILLEGAL_ACTION');

    // The play timing is the turn player's: the other player has nothing to do and cannot activate their own ability.
    expect(legalActions(s, cat, 1)).toEqual([]);
    expect(attempt(s, activate(1, idAt(s, 1, 2), 0))).toBe('NOT_YOUR_DECISION');
  });

  it('[MAIN-04] an ability that is valid only under a condition is offered once the condition holds (level 1 here), and can then be used', () => {
    const atZero = mainPhase({ stage: { 1: 'TAC' }, stock: ['G0', 'G0'] });
    expect(activations(atZero)).toEqual(['TAC#1', 'TAC#3']);

    const s = mainPhase({ stage: { 1: 'TAC' }, stock: ['G0', 'G0'], level: ['Y0'], deck: ['G0', 'B1'] });
    expect(activations(s)).toEqual(['TAC#1', 'TAC#2', 'TAC#3']);
    const tac = idAt(s, 0, 1);
    const r = go(s, activate(0, tac, 2));
    expect(trace(r.state, r.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:TAC#2:activated',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
  });

  it('[MAIN-04] using an ability pays its cost and resolves it, then a check timing and a new main play timing follow; it can be used again for as long as its cost can be paid', () => {
    const s0 = mainPhase({ stage: { 1: 'SIG' }, stock: ['G0', 'B0'], deck: ['G0', 'R0', 'B1'] });
    const sig = idAt(s0, 0, 1);
    expect(activations(s0)).toEqual(['SIG#0']);

    const a = go(s0, activate(0, sig, 0));
    expect(trace(a.state, a.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:B0:0.stock->0.waiting',
      'ability:0:SIG#0:activated',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
      'check',
      'playTiming:0:main',
    ]);
    expect(a.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(a.state.resolving).toBeNull();
    expect(defsIn(a.state, 0, 'stock')).toEqual(['G0']);
    expect(defsIn(a.state, 0, 'hand')).toEqual(['B1']);

    // Same ability, same play timing loop: still payable with one stock left.
    expect(activations(a.state)).toEqual(['SIG#0']);
    const b = go(a.state, activate(0, sig, 0));
    expect(defsIn(b.state, 0, 'stock')).toEqual([]);
    expect(defsIn(b.state, 0, 'hand')).toEqual(['B1', 'R0']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['B0', 'G0']);

    // Now the cost cannot be paid: the ability is gone from the offer, and passing leaves the main phase.
    expect(activations(b.state)).toEqual([]);
    expect(attempt(b.state, activate(0, sig, 0))).toBe('ILLEGAL_ACTION');
    const c = go(b.state, pass(0));
    expect(c.state.phase).toBe('climax');
  });

  it('[MAIN-04] a cost that rests the character can be paid once; after that the ability is no longer offered in this main phase', () => {
    const s = mainPhase({ stage: { 1: 'GAT' }, stock: ['G0', 'G0', 'G0', 'G0'] });
    const gat = idAt(s, 0, 1);
    expect(activations(s)).toEqual(['GAT#0']);
    const r = go(s, activate(0, gat, 0));
    expect(orientationOf(r.state, gat)).toBe('rest');
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(activations(r.state)).toEqual([]);
  });

  it('[MAIN-04] outside the main play timing the same abilities are not usable: not in the climax phase, not at attack declaration', () => {
    // A yellow clock card lets the yellow climax meet its color requirement.
    const s = mainPhase({ stage: { 1: 'SIG', 2: 'TAC' }, stock: ['G0', 'G0', 'G0'], hand: ['YX'], clock: ['Y0'] });
    const sig = idAt(s, 0, 1);
    const tac = idAt(s, 0, 2);
    expect(activations(s)).toEqual(['SIG#0', 'TAC#1', 'TAC#3']);

    const climax = go(s, pass(0)).state;
    expect(climax.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    expect(offers(climax)).toEqual(['PASS', 'PLAY_CLIMAX:YX']);
    expect(attempt(climax, activate(0, sig, 0))).toBe('ILLEGAL_ACTION');
    expect(attempt(climax, activate(0, tac, 3))).toBe('ILLEGAL_ACTION');

    const declaration = go(climax, pass(0)).state;
    expect(declaration.pending).toEqual({ kind: 'attack', player: 0 });
    expect(attempt(declaration, activate(0, sig, 0))).toBe('ILLEGAL_ACTION');
  });
});

// =============================================================================
// CONC-08: whoever plays an activated ability is its master (CR 4.3.4)
// =============================================================================

describe('CONC-08: the player who uses an activated ability is its master', () => {
  it('[CONC-08] the turn player using an ability in the main phase is its master: the cost is theirs, they choose, "you" means them and "your opponent" the other player', () => {
    const s0 = mainPhase(
      { stage: { 1: 'ARB', 2: 'Y0', 3: 'Y1' }, stock: ['G0'] },
      // The opponent has the same card; its presence changes nothing about who is master of player 0's use.
      { stage: { 1: 'R0', 2: 'R1', 3: 'ARB' }, stock: ['R0', 'R0'], deck: ['R0', 'B1'] },
    );
    const arb = idAt(s0, 0, 1);
    const [y0, y1] = [idAt(s0, 0, 2), idAt(s0, 0, 3)];
    const [r0, r1, arb1] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];

    const a = go(s0, activate(0, arb, 0));
    // Player 0 is the master: they choose among their own other characters (not ARB itself, nothing of player 1's).
    expect(a.state.resolving?.master).toBe(0);
    expect(a.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', as: 'ally', card: arb, options: [y0, y1], picked: [], min: 1, max: 1 });
    // The cost came out of player 0's stock only.
    expect(defsIn(a.state, 0, 'stock')).toEqual([]);
    expect(defsIn(a.state, 1, 'stock')).toEqual(['R0', 'R0']);
    expect(trace(a.state, a.events)).toEqual(['action:ACTIVATE:0', 'move:cost:G0:0.stock->0.waiting', 'ability:0:ARB#0:activated', 'effect:0:choose']);

    const b = go(a.state, choose(0, y1));
    expect(upTo(trace(b.state, b.events), 'playTiming:0:main')).toEqual([
      'action:CHOOSE_CARD:0',
      'chosen:0:Y1',
      'effect:0:power',
      'mod:Y1:power+1000',
      'effect:0:power',
      'mod:R0:power-1000',
      'mod:R1:power-1000',
      'mod:ARB:power-1000',
      'effect:0:draw',
      'move:draw:B1:1.deck->1.hand',
      'check',
      'playTiming:0:main',
    ]);
    expect([y0, y1, arb].map((c) => currentPower(b.state, cat, c))).toEqual([2000, 6000, 3000]);
    expect([r0, r1, arb1].map((c) => currentPower(b.state, cat, c))).toEqual([2000, 3500, 2000]);
    expect(defsIn(b.state, 1, 'hand')).toEqual(['B1']);
    expect(defsIn(b.state, 0, 'hand')).toEqual([]);
  });

  it('[CONC-08] the same counter ability has as master whichever player uses it in the Counter Step, not the turn player; that one use ends their play timing', () => {
    for (const atk of [0, 1] as const) {
      const def = other(atk);
      const zones: Record<PlayerId, ZoneSpec> = { 0: {}, 1: {} };
      // A second attacker on position 1 keeps the turn going after this attack, so the run stops at the next declaration.
      zones[atk] = { stage: { 1: 'Y0', 2: 'Y1' }, stock: ['Y0'], hand: [] };
      zones[def] = { stage: { 2: 'SEN' }, stock: ['G0', 'B0'], deck: ['G0', 'G0', 'G0', 'B1'], hand: [] };
      const s0 = attackPhase(atk, zones);
      const attacker = idAt(s0, atk, 2);
      const sentinel = idAt(s0, def, 2);

      const counter = go(s0, { type: 'ATTACK', player: atk, slot: 2, attack: 'frontal' }).state;
      expect(counter.pending).toEqual({ kind: 'play', player: def, window: 'counter' });
      // Only the counter ability is valid here; its "during your opponent's turn" condition is read from the user's side.
      expect(offers(counter)).toEqual(['ACTIVATE:SEN#0', 'PASS']);
      const atkStock = defsIn(counter, atk, 'stock');
      const atkHand = defsIn(counter, atk, 'hand');

      const r = go(counter, activate(def, sentinel, 0));
      expect(upTo(trace(r.state, r.events), 'step:damage')).toEqual([
        `action:ACTIVATE:${def}`,
        `move:cost:B0:${def}.stock->${def}.waiting`,
        `ability:${def}:SEN#0:activated`,
        `effect:${def}:draw`,
        `move:draw:B1:${def}.deck->${def}.hand`,
        `effect:${def}:power`,
        'mod:SEN:power+2000',
        `effect:${def}:power`,
        'mod:Y1:power-1000',
        'check',
        'step:damage',
      ]);
      // No second play timing for the user in this step (CR 7.4.1.2.2): the attack runs on to the next declaration.
      expect(trace(r.state, r.events).filter((t) => t.startsWith('playTiming'))).toEqual([]);
      expect(r.state.pending).toEqual({ kind: 'attack', player: atk });
      // The user paid and drew; the turn player's stock and hand are untouched.
      expect(defsIn(r.state, def, 'stock')).toEqual(['G0']);
      expect(defsIn(r.state, def, 'hand')).toEqual(['B1']);
      expect(defsIn(r.state, atk, 'stock')).toEqual(atkStock);
      expect(defsIn(r.state, atk, 'hand')).toEqual(atkHand);
      // "Your defending character" is the user's; "your opponent's attacking character" is the turn player's.
      expect(r.events.filter((e) => e.kind === 'modifier').map((e) => (e.kind === 'modifier' ? [e.card, e.amount] : []))).toEqual([
        [sentinel, 2000],
        [attacker, -1000],
      ]);
    }
  });

  it('[CONC-08] during the turn player\'s attack, the non-turn player who uses a counter ability makes its choices: "your characters" are theirs, and the turn player has no say', () => {
    const s0 = attackPhase(0, { 0: { stage: { 1: 'Y0', 2: 'Y1' } }, 1: { stage: { 1: 'R0', 2: 'RAL' }, stock: ['G0', 'B0'] } });
    const [r0, ral] = [idAt(s0, 1, 1), idAt(s0, 1, 2)];
    const counter = go(s0, { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' }).state;
    expect(counter.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    const a = go(counter, activate(1, ral, 0));
    expect(trace(a.state, a.events)).toEqual(['action:ACTIVATE:1', 'move:cost:B0:1.stock->1.waiting', 'ability:1:RAL#0:activated', 'effect:1:choose']);
    // Player 1 is the master even though it is player 0's turn: the choice is theirs, among their own characters.
    expect(a.state.active).toBe(0);
    expect(a.state.resolving?.master).toBe(1);
    expect(a.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'target', as: 'mate', card: ral, options: [r0, ral], picked: [], min: 1, max: 1 });
    expect(legalActions(a.state, cat, 0)).toEqual([]);
    expect(attempt(a.state, choose(0, idAt(s0, 0, 1)))).toBe('NOT_YOUR_DECISION');

    const b = go(a.state, choose(1, r0));
    expect(upTo(trace(b.state, b.events), 'step:damage')).toEqual(['action:CHOOSE_CARD:1', 'chosen:1:R0', 'effect:1:power', 'mod:R0:power+1500', 'check', 'step:damage']);
    expect(currentPower(b.state, cat, r0)).toBe(4500);
  });

  it('[CONC-08] the master is the player who uses the ability, not the card\'s owner: a card owned by player 1 on player 0\'s stage, used by player 0, pays, chooses and reads "you" as player 0', () => {
    const base = mainPhase({ stage: { 2: 'Y0', 3: 'Y1' }, stock: ['G0'] }, { stage: { 1: 'R0' }, waiting: ['ARB'], stock: ['R0', 'R0'], deck: ['R0', 'B1'] });
    // No card in this pool moves an opponent's card onto your stage, so the test places it there directly.
    const s0 = ops.deepClone(base);
    const arb = cardIn(s0, 1, 'waiting', 'ARB');
    ops.moveCard(s0, arb, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    expect(s0.cards[arb]?.owner).toBe(1);
    const [y0, y1, r0] = [idAt(s0, 0, 2), idAt(s0, 0, 3), idAt(s0, 1, 1)];
    expect(activations(s0)).toEqual(['ARB#0']);

    const a = go(s0, activate(0, arb, 0));
    expect(a.state.resolving?.master).toBe(0);
    expect(a.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', as: 'ally', card: arb, options: [y0, y1], picked: [], min: 1, max: 1 });
    expect(defsIn(a.state, 0, 'stock')).toEqual([]);
    expect(defsIn(a.state, 1, 'stock')).toEqual(['R0', 'R0']);

    const b = go(a.state, choose(0, y0));
    expect(upTo(trace(b.state, b.events), 'playTiming:0:main')).toEqual([
      'action:CHOOSE_CARD:0',
      'chosen:0:Y0',
      'effect:0:power',
      'mod:Y0:power+1000',
      'effect:0:power',
      'mod:R0:power-1000',
      'effect:0:draw',
      'move:draw:B1:1.deck->1.hand',
      'check',
      'playTiming:0:main',
    ]);
    // ARB stands on player 0's stage, so it is not one of "your opponent's characters".
    expect([y0, arb, r0].map((c) => currentPower(b.state, cat, c))).toEqual([3000, 3000, 2000]);
  });

  it('[CONC-08] a counter ability\'s hand-card cost is paid from its user\'s hand: with an empty hand it is not offered even though the turn player holds cards', () => {
    const attack: Action = { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' };
    const empty = attackPhase(0, { 0: { stage: { 1: 'Y0', 2: 'Y1' }, hand: ['Y0', 'R0', 'B0'] }, 1: { stage: { 2: 'MIR' } } });
    const noCard = go(empty, attack).state;
    expect(noCard.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(offers(noCard)).toEqual(['PASS']);

    const s0 = attackPhase(0, { 0: { stage: { 1: 'Y0', 2: 'Y1' } }, 1: { stage: { 2: 'MIR' }, hand: ['B1'] } });
    const mir = idAt(s0, 1, 2);
    const counter = go(s0, attack).state;
    expect(offers(counter)).toEqual(['ACTIVATE:MIR#0', 'PASS']);
    const r = go(counter, activate(1, mir, 0));
    expect(upTo(trace(r.state, r.events), 'ability:1:MIR#0:activated')).toEqual(['action:ACTIVATE:1', 'move:cost:B1:1.hand->1.waiting', 'ability:1:MIR#0:activated']);
    expect(defsIn(r.state, 1, 'hand')).toEqual([]);
    expect(defsIn(r.state, 0, 'hand')).toEqual([]);
  });
});

// =============================================================================
// COST-01: the cost is the bracketed actions, paid in the order written (CR 8.4.1-8.4.2.1)
// =============================================================================

describe('COST-01: paying a cost means doing its actions in the order written', () => {
  it('[COST-01] a three-part cost is determined first, then paid action by action as written (stock, hand card, rest) before the ability counts as played', () => {
    const s0 = mainPhase({ stage: { 1: 'CUR' }, stock: ['G0', 'B0'], hand: ['Y0', 'R0'] });
    const cur = idAt(s0, 0, 1);
    const [y0, r0] = [cardIn(s0, 0, 'hand', 'Y0'), cardIn(s0, 0, 'hand', 'R0')];

    // Which hand card pays is chosen first; nothing has been paid while the choice is open.
    const a = go(s0, activate(0, cur, 0));
    expect(a.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'costDiscard', card: cur, options: [y0, r0], picked: [], min: 1, max: 1 });
    expect(trace(a.state, a.events)).toEqual(['action:ACTIVATE:0']);
    expect(defsIn(a.state, 0, 'stock')).toEqual(['G0', 'B0']);
    expect(defsIn(a.state, 0, 'hand')).toEqual(['Y0', 'R0']);
    expect(orientationOf(a.state, cur)).toBe('stand');
    expect(legalActions(a.state, cat)).not.toContainEqual(pass(0));

    const b = go(a.state, choose(0, r0));
    expect(trace(b.state, b.events)).toEqual([
      'action:CHOOSE_CARD:0',
      'move:cost:B0:0.stock->0.waiting',
      'move:cost:R0:0.hand->0.waiting',
      'orient:CUR:rest',
      'ability:0:CUR#0:activated',
      'effect:0:power',
      'mod:CUR:power+1500',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(b.state, 0, 'stock')).toEqual(['G0']);
    expect(defsIn(b.state, 0, 'hand')).toEqual(['Y0']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['B0', 'R0']);
    expect(orientationOf(b.state, cur)).toBe('rest');
    expect(currentPower(b.state, cat, cur)).toBe(3500);
  });

  it('[COST-01] the same three actions written in the opposite order (rest, hand card, stock) are paid in that opposite order', () => {
    const s0 = mainPhase({ stage: { 1: 'POR' }, stock: ['G0', 'B0'], hand: ['Y0', 'R0'] });
    const por = idAt(s0, 0, 1);
    const a = go(s0, activate(0, por, 0));
    expect(a.state.pending).toMatchObject({ kind: 'pick', player: 0, purpose: 'costDiscard', card: por });
    expect(orientationOf(a.state, por)).toBe('stand');

    const b = go(a.state, choose(0, cardIn(a.state, 0, 'hand', 'R0')));
    expect(trace(b.state, b.events)).toEqual([
      'action:CHOOSE_CARD:0',
      'orient:POR:rest',
      'move:cost:R0:0.hand->0.waiting',
      'move:cost:B0:0.stock->0.waiting',
      'ability:0:POR#0:activated',
      'effect:0:power',
      'mod:POR:power+1500',
      'check',
      'playTiming:0:main',
    ]);
  });

  it('[COST-01] putting the card itself into the waiting room can be part of the cost: it is paid in its written place, before the ability counts as played, and the effect still resolves', () => {
    // One stock only, so the Encore that the card's move triggers cannot be paid and asks nothing.
    const s0 = mainPhase({ stage: { 1: 'DEC' }, stock: ['B0'], deck: ['G0', 'B1'] });
    const dec = idAt(s0, 0, 1);
    const r = go(s0, activate(0, dec, 0));
    expect(trace(r.state, r.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:B0:0.stock->0.waiting',
      'move:cost:DEC:0.stage->0.waiting',
      'ability:0:DEC#0:activated',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['B0', 'DEC']);
    expect(r.state.players[0].stage[0]).toEqual([]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
  });

  it('[COST-01] an automatic ability\'s cost is the same kind of thing: once the player agrees to pay, its actions are done in the order written (hand card, then stock)', () => {
    const s0 = mainPhase({ hand: ['HER', 'Y0', 'R0'], stock: ['G0', 'B0'], deck: ['G0', 'B1'] });
    const her = cardIn(s0, 0, 'hand', 'HER');

    const played = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: her, slot: 1 });
    expect(played.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: her });
    expect(defsIn(played.state, 0, 'stock')).toEqual(['G0', 'B0']);

    const yes = go(played.state, accept(0));
    expect(yes.state.pending).toMatchObject({ kind: 'pick', player: 0, purpose: 'costDiscard', card: her, min: 1, max: 1 });
    expect(defsIn(yes.state, 0, 'stock')).toEqual(['G0', 'B0']);
    expect(defsIn(yes.state, 0, 'hand')).toEqual(['Y0', 'R0']);

    const paid = go(yes.state, choose(0, cardIn(yes.state, 0, 'hand', 'R0')));
    expect(upTo(trace(paid.state, paid.events), 'move:draw:B1:0.deck->0.hand')).toEqual([
      'action:CHOOSE_CARD:0',
      'move:cost:R0:0.hand->0.waiting',
      'move:cost:B0:0.stock->0.waiting',
      'ability:0:HER#0:automatic',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
    ]);
    expect(paid.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(defsIn(paid.state, 0, 'hand')).toEqual(['Y0', 'B1']);
  });
});

// =============================================================================
// COST-03: a cost that cannot be paid in full is not paid at all (CR 8.4.2.2, 8.6.2.3.2)
// =============================================================================

describe('COST-03: all of the cost or none of it', () => {
  const cases: { name: string; stage: string; rested?: true; spec: ZoneSpec }[] = [
    // Stock part payable (3 stock), discard part not (1 card for 2).
    { name: 'BAN with 3 stock and 1 hand card', stage: 'BAN', spec: { stock: ['G0', 'G0', 'G0'], hand: ['Y0'] } },
    // The rest part would come first and is payable; the stock part is not.
    { name: 'GAT standing with 1 stock', stage: 'GAT', spec: { stock: ['G0'] } },
    // The rest part cannot be paid; the stock part could.
    { name: 'GAT already rested with 4 stock', stage: 'GAT', rested: true, spec: { stock: ['G0', 'G0', 'G0', 'G0'] } },
    // Each stock part alone fits in 2 stock; the whole cost needs 3.
    { name: 'TWN with 2 stock', stage: 'TWN', spec: { stock: ['G0', 'G0'] } },
    // The hand has cards, but none that the filtered part accepts.
    { name: 'TID with only yellow and red hand cards', stage: 'TID', spec: { hand: ['Y0', 'R0', 'Y1'] } },
  ];

  it('[COST-03] if any part of the cost cannot be paid, the ability cannot be used, so none of its cost is paid', () => {
    for (const c of cases) {
      const s = mainPhase({ ...c.spec, stage: { 1: c.rested ? { def: c.stage, orientation: 'rest' } : c.stage } });
      const card = idAt(s, 0, 1);
      expect(s.pending, c.name).toEqual({ kind: 'play', player: 0, window: 'main' });
      expect(orientationOf(s, card), c.name).toBe(c.rested ? 'rest' : 'stand');
      // Not offered, and refused if sent anyway: the payable parts are not paid on their own.
      expect(activations(s), c.name).toEqual([]);
      expect(attempt(s, activate(0, card, 0)), c.name).toBe('ILLEGAL_ACTION');
      expect(applyAction(s, cat, activate(0, card, 0)), c.name).toMatchObject({ ok: false, error: { code: 'ILLEGAL_ACTION' } });
    }
  });

  it('[COST-03] with just enough for every part the same costs can be paid, and then all of each is paid', () => {
    // BAN: 1 stock and exactly 2 hand cards. Both hand cards must go, so there is no real choice to ask about.
    const ban = mainPhase({ stage: { 1: 'BAN' }, stock: ['B0'], hand: ['Y0', 'R0'], deck: ['G0', 'B1'] });
    expect(activations(ban)).toEqual(['BAN#0']);
    const b = go(ban, activate(0, idAt(ban, 0, 1), 0));
    expect(costMoves(b.events).map((e) => (e.kind === 'move' ? defOf(b.state, e.card) : ''))).toEqual(['B0', 'Y0', 'R0']);
    expect(defsIn(b.state, 0, 'hand')).toEqual(['B1']);

    // GAT standing with exactly 2 stock.
    const gat = mainPhase({ stage: { 1: 'GAT' }, stock: ['G0', 'B0'] });
    expect(activations(gat)).toEqual(['GAT#0']);
    const g = go(gat, activate(0, idAt(gat, 0, 1), 0));
    expect(trace(g.state, g.events).slice(0, 5)).toEqual([
      'action:ACTIVATE:0',
      'orient:GAT:rest',
      'move:cost:B0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:GAT#0:activated',
    ]);

    // TWN with exactly 3 stock: both parts, 2 then 1.
    const twn = mainPhase({ stage: { 1: 'TWN' }, stock: ['G0', 'B0', 'R0'] });
    expect(activations(twn)).toEqual(['TWN#0']);
    const t = go(twn, activate(0, idAt(twn, 0, 1), 0));
    expect(costMoves(t.events)).toHaveLength(3);
    expect(defsIn(t.state, 0, 'stock')).toEqual([]);

    // TID with blue cards in hand: only blue cards may pay.
    const tid = mainPhase({ stage: { 1: 'TID' }, hand: ['Y0', 'B0', 'B1'] });
    expect(activations(tid)).toEqual(['TID#0']);
    const tidCard = idAt(tid, 0, 1);
    const pick = go(tid, activate(0, tidCard, 0)).state;
    expect(pick.pending).toEqual({
      kind: 'pick',
      player: 0,
      purpose: 'costDiscard',
      card: tidCard,
      options: [cardIn(tid, 0, 'hand', 'B0'), cardIn(tid, 0, 'hand', 'B1')],
      picked: [],
      min: 1,
      max: 1,
    });
    expect(attempt(pick, choose(0, cardIn(tid, 0, 'hand', 'Y0')))).toBe('ILLEGAL_ACTION');
  });

  it('[COST-03] the parts are paid one after another, so a part made impossible by an earlier part means the whole cost cannot be paid: the ability is not usable, nothing is paid, nothing breaks', () => {
    const sequences: [string, CostPart[]][] = [
      // Once the card is in the waiting room it is no longer on the stage to be rested.
      ['SRX', [{ pay: 'selfToWaiting' }, { pay: 'rest' }]],
      // A rested card cannot be rested again (CR 1.3.2.1), so the second part cannot be done.
      ['RRX', [{ pay: 'rest' }, { pay: 'rest' }]],
      // After the first part the card is already in the waiting room, as a new card (CR 3.1.4, 1.3.2.1).
      ['SSX', [{ pay: 'selfToWaiting' }, { pay: 'selfToWaiting' }]],
    ];
    /** "not usable" when the card is refused by the catalog check or its ability is neither offered nor accepted. */
    const outcome = (id: string, cost: CostPart[]): string => {
      const local: CardCatalog = { ...cat, [id]: char(id, `Broken Relay ${id}`, [{ kind: 'activated', timing: 'main', cost, effect: [drawOne] }]) };
      // A catalog check that refuses such a card also keeps the cost from being used.
      if (validateCatalog(local).length > 0) return 'not usable';
      const s = makeState(local, { start: 'main', players: [{ deck: PLAIN, stage: { 1: id }, stock: ['G0', 'G0'] }, { deck: PLAIN }] });
      const card = idAt(s, 0, 1);
      const offered = legalActions(s, local).some((a) => a.type === 'ACTIVATE');
      let result: string;
      try {
        const r = applyAction(s, local, activate(0, card, 0));
        result = r.ok ? `used, paying ${trace(r.state, r.events).filter((t) => t.startsWith('move:cost') || t.startsWith('orient')).join(' + ')}` : r.error.code;
      } catch (e) {
        result = `applyAction threw ${String(e)}`;
      }
      return !offered && result === 'ILLEGAL_ACTION' ? 'not usable' : `offered: ${offered}; ${result}`;
    };
    expect(Object.fromEntries(sequences.map(([id, cost]) => [id, outcome(id, cost)]))).toEqual({ SRX: 'not usable', RRX: 'not usable', SSX: 'not usable' });
  });

  it('[COST-03] an automatic ability whose cost cannot be paid in full asks nothing and pays nothing (hand card available, stock missing)', () => {
    const s0 = mainPhase({ hand: ['HER', 'Y0', 'R0'], stock: [], deck: ['G0', 'B1'] });
    const her = cardIn(s0, 0, 'hand', 'HER');
    const r = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: her, slot: 1 });
    // Straight back to the main play timing: no question about paying, no card paid, no effect.
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(costMoves(r.events)).toEqual([]);
    const t = trace(r.state, r.events);
    expect(t.filter((x) => x.startsWith('optional') || x.startsWith('ability') || x.startsWith('effect') || x.startsWith('move:draw'))).toEqual([]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['Y0', 'R0']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual([]);
  });
});

// =============================================================================
// COST-04: a circled number means exactly that many stock cards to the waiting room (CR 8.4.3)
// =============================================================================

describe('COST-04: paying (X) moves exactly X stock cards', () => {
  it('[COST-04] a (2) cost moves exactly two cards, from the top of the master\'s stock, into the master\'s waiting room', () => {
    // Stock bottom -> top: G0, B0, R0, Y0, B1. The opponent's stock is there to show it is not touched.
    const s0 = mainPhase({ stage: { 1: 'TOL' }, stock: ['G0', 'B0', 'R0', 'Y0', 'B1'] }, { stock: ['R0', 'R0', 'R0'] });
    const tol = idAt(s0, 0, 1);
    const r = go(s0, activate(0, tol, 0));
    expect(trace(r.state, r.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:B1:0.stock->0.waiting',
      'move:cost:Y0:0.stock->0.waiting',
      'ability:0:TOL#0:activated',
      'effect:0:power',
      'mod:TOL:power+2000',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'stock')).toEqual(['G0', 'B0', 'R0']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['B1', 'Y0']);
    expect(defsIn(r.state, 1, 'stock')).toEqual(['R0', 'R0', 'R0']);
    expect(defsIn(r.state, 1, 'waiting')).toEqual([]);
    expect(currentPower(r.state, cat, tol)).toBe(4000);
  });

  it('[COST-04] with fewer than X stock cards the (X) cannot be paid; with exactly X all of them go and no more', () => {
    const short = mainPhase({ stage: { 1: 'TOL' }, stock: ['B0'] });
    expect(activations(short)).toEqual([]);
    expect(attempt(short, activate(0, idAt(short, 0, 1), 0))).toBe('ILLEGAL_ACTION');

    const exact = mainPhase({ stage: { 1: 'TOL' }, stock: ['G0', 'B0'] });
    const r = go(exact, activate(0, idAt(exact, 0, 1), 0));
    expect(costMoves(r.events)).toHaveLength(2);
    expect(defsIn(r.state, 0, 'stock')).toEqual([]);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['B0', 'G0']);
    expect(activations(r.state)).toEqual([]);
  });

  it('[COST-04] the default Encore (3) pays exactly three stock cards from the top; the fourth stays', () => {
    // Playing Y0 onto Y1's position sends Y1 to the waiting room, which triggers its Encore.
    const s0 = mainPhase({ stage: { 1: 'Y1' }, hand: ['Y0'], stock: ['G0', 'B0', 'R0', 'Y0'] });
    const y1 = idAt(s0, 0, 1);
    const prompt = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s0, 0, 'hand', 'Y0'), slot: 1 }).state;
    expect(prompt.pending).toMatchObject({ kind: 'encore', player: 0, card: y1, cost: 3 });
    const r = go(prompt, accept(0));
    expect(upTo(trace(r.state, r.events), 'auto:encore:Y1')).toEqual([
      'action:ACCEPT:0',
      'move:cost:Y0:0.stock->0.waiting',
      'move:cost:R0:0.stock->0.waiting',
      'move:cost:B0:0.stock->0.waiting',
      'auto:encore:Y1',
    ]);
    expect(defsIn(r.state, 0, 'stock')).toEqual(['G0']);
    expect(costMoves(r.events)).toHaveLength(3);
  });

  it('[COST-04] in the Counter Step the defending player is the master: their (2) leaves the top of their own stock, and only their stock decides if it can be paid', () => {
    const attack: Action = { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' };
    // The turn player has plenty of stock, the defending player only 1: not offered.
    const poor = attackPhase(0, { 0: { stage: { 1: 'Y0', 2: 'Y1' }, stock: ['Y0', 'Y0', 'Y0', 'Y0', 'Y0'] }, 1: { stage: { 2: 'BUL' }, stock: ['G0'] } });
    const poorCounter = go(poor, attack).state;
    expect(poorCounter.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(defsIn(poorCounter, 0, 'stock').length).toBeGreaterThanOrEqual(5);
    expect(offers(poorCounter)).toEqual(['PASS']);

    // The defending player has 3 stock and the turn player only the card the trigger check put there: offered and paid by player 1.
    const s0 = attackPhase(0, { 0: { stage: { 1: 'Y0', 2: 'Y1' } }, 1: { stage: { 2: 'BUL' }, stock: ['G0', 'B0', 'R0'] } });
    const bul = idAt(s0, 1, 2);
    const counter = go(s0, attack).state;
    expect(defsIn(counter, 0, 'stock')).toHaveLength(1);
    expect(offers(counter)).toEqual(['ACTIVATE:BUL#0', 'PASS']);
    const atkStock = defsIn(counter, 0, 'stock');
    const atkWaiting = defsIn(counter, 0, 'waiting');
    const r = go(counter, activate(1, bul, 0));
    expect(upTo(trace(r.state, r.events), 'ability:1:BUL#0:activated')).toEqual([
      'action:ACTIVATE:1',
      'move:cost:R0:1.stock->1.waiting',
      'move:cost:B0:1.stock->1.waiting',
      'ability:1:BUL#0:activated',
    ]);
    expect(defsIn(r.state, 1, 'stock')).toEqual(['G0']);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['R0', 'B0']);
    expect(defsIn(r.state, 0, 'stock')).toEqual(atkStock);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(atkWaiting);
  });
});
