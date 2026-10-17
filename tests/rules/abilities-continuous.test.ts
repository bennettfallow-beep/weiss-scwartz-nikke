// Rule tests for M3: effects that are active or inactive under a condition
// (CR 8.3), which cards a continuous effect applies to (CR 8.9.2 and 8.9.3),
// and who is master of an effect (CR 4.3.3).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentPower, currentSoul, legalActions, locate, validateCatalog } from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

/** A level 0 yellow character, 2000 power, soul 1, with the given abilities. */
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

/** A level 0 character with no abilities. */
const plain = (id: string, name: string, more: Partial<CardDef> = {}): CardDef => ({ id, name, kind: 'character', color: 'yellow', level: 0, cost: 0, power: 2000, soul: 1, ...more });

const stock1 = { pay: 'stock', count: 1 } as const;
const draw1 = { do: 'draw', count: 1 } as const;

const extra: CardDef[] = [
  // --- ABL-06 ---
  // [CONT] While you have 2 or more characters named "Yellow Scout", this card gets +1500 power and +1 soul.
  char(
    'WRD',
    'Ward Sentry',
    [
      {
        kind: 'continuous',
        when: [{ if: 'count', what: { side: 'you', name: 'Yellow Scout' }, min: 2 }],
        modifiers: [
          { stat: 'power', amount: 1500, target: 'this' },
          { stat: 'soul', amount: 1, target: 'this' },
        ],
      },
    ],
    { power: 3000 },
  ),
  // [AUTO] When this card is played, draw a card. Then, if your level is 1 or higher, choose 1 of your other
  // characters; it gets +2000 power.
  char('SPT', 'Signal Spotter', [
    {
      kind: 'automatic',
      trigger: { on: 'play' },
      effect: [
        draw1,
        {
          do: 'if',
          when: [{ if: 'level', min: 1 }],
          then: [
            { do: 'choose', as: 'ally', count: 1, what: { side: 'you', other: true } },
            { do: 'power', amount: 2000, target: { ref: 'ally' } },
          ],
        },
      ],
    },
  ]),
  // [AUTO] When played, put the top card of your deck into your stock.
  // [AUTO] When played, if you have 1 or more cards in your stock, draw a card.
  char('LDG', 'Ledger Twin', [
    { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'stockFromDeck', count: 1 }] },
    { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'if', when: [{ if: 'count', what: { side: 'you', zone: 'stock' }, min: 1 }], then: [draw1] }] },
  ]),
  // [AUTO] When played, put the top card of your deck into your stock. Then, if you have 1 or more cards in your
  // stock, draw a card.
  char('LDS', 'Ledger Clerk', [
    {
      kind: 'automatic',
      trigger: { on: 'play' },
      effect: [{ do: 'stockFromDeck', count: 1 }, { do: 'if', when: [{ if: 'count', what: { side: 'you', zone: 'stock' }, min: 1 }], then: [draw1] }],
    },
  ]),
  // [CONT] While your level is 1 or higher, this card gets +1000 power.
  char('NLK', 'Night Lookout', [{ kind: 'continuous', when: [{ if: 'level', min: 1 }], modifiers: [{ stat: 'power', amount: 1000, target: 'this' }] }]),
  // [CONT] During your turn, this card gets +2000 power. [CONT] During your opponent's turn, this card gets +1 soul.
  char(
    'DTY',
    'Duty Lantern',
    [
      { kind: 'continuous', when: [{ if: 'turn', side: 'you' }], modifiers: [{ stat: 'power', amount: 2000, target: 'this' }] },
      { kind: 'continuous', when: [{ if: 'turn', side: 'opponent' }], modifiers: [{ stat: 'soul', amount: 1, target: 'this' }] },
    ],
    { color: 'red' },
  ),

  // --- ABL-20 ---
  // Event: until end of turn, each character you have gets +1000 power.
  { id: 'RLY', name: 'Rally Flare', kind: 'event', color: 'yellow', level: 0, cost: 0, effect: [{ do: 'power', amount: 1000, target: { all: { side: 'you' } } }] },
  // [ACT] [(1)] This card gets +1500 power (no stated duration). [ACT] [(1)] Return this card to your hand.
  char('HOP', 'Hop Courier', [
    { kind: 'activated', timing: 'main', cost: [stock1], effect: [{ do: 'power', amount: 1500, target: 'this', duration: 'game' }] },
    { kind: 'activated', timing: 'main', cost: [stock1], effect: [{ do: 'returnToHand', target: 'this' }] },
  ]),
  // [AUTO] When this card is played, all of your other characters get +1000 power until end of turn.
  char('HRN', 'Horn Bearer', [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'power', amount: 1000, target: { all: { side: 'you', other: true } } }] }]),
  // [AUTO] When this card is played, choose 1 of your other characters; it gets -2000 power until end of turn.
  // [AUTO] When this card is played, all of your other characters get +1000 power until end of turn.
  char('DRM', 'Signal Drummer', [
    {
      kind: 'automatic',
      trigger: { on: 'play' },
      effect: [
        { do: 'choose', as: 'mark', count: 1, what: { side: 'you', other: true } },
        { do: 'power', amount: -2000, target: { ref: 'mark' } },
      ],
    },
    { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'power', amount: 1000, target: { all: { side: 'you', other: true } } }] },
  ]),

  // --- ABL-21 ---
  // [CONT] All of your other characters get +1000 power.
  char('AUR', 'Beacon Standard', [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', other: true } }] }]),
  // [CONT] All of your opponent's characters get -1000 power.
  char('HEX', 'Gloom Warden', [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: -1000, target: { side: 'opponent' } }] }], { color: 'red', power: 3000 }),
  plain('FRL', 'Frail Runner', { power: 1000 }),
  // [ACT] [Put this card into your waiting room] Draw a card.
  char('FLD', 'Folding Decoy', [{ kind: 'activated', timing: 'main', cost: [{ pay: 'selfToWaiting' }], effect: [draw1] }]),

  // --- CONC-07 ---
  // [AUTO] When this card becomes reversed, choose 1 of your other characters; it gets +1000 power. Draw a card.
  // Deal 1 damage to your opponent.
  char(
    'MRR',
    'Mirror Warden',
    [
      {
        kind: 'automatic',
        trigger: { on: 'reversed' },
        effect: [
          { do: 'choose', as: 'ally', count: 1, what: { side: 'you', other: true } },
          { do: 'power', amount: 1000, target: { ref: 'ally' } },
          draw1,
          { do: 'damageOpp', amount: 1 },
        ],
      },
    ],
    { color: 'red', power: 1000 },
  ),
  // [CONT] All of your other characters get +1000 power, and all of your opponent's characters get -500 power.
  char(
    'CHR',
    'Choir Banner',
    [
      {
        kind: 'continuous',
        modifiers: [
          { stat: 'power', amount: 1000, target: { side: 'you', other: true } },
          { stat: 'power', amount: -500, target: { side: 'opponent' } },
        ],
      },
    ],
    { color: 'red' },
  ),
  // Counter event: choose 1 of your characters; it gets +2000 power. Draw a card.
  {
    id: 'GRD',
    name: 'Guard Hymn',
    kind: 'event',
    color: 'red',
    level: 0,
    cost: 0,
    counter: true,
    effect: [{ do: 'choose', as: 'guard', count: 1, what: { side: 'you' } }, { do: 'power', amount: 2000, target: { ref: 'guard' } }, draw1],
  },
  // Soul 0: its attacks deal no damage, which keeps the battle tests short.
  plain('BRT', 'Brute Walker', { power: 5000, soul: 0 }),
  // [ACT] [(1)] Draw a card. All of your other characters get +500 power until end of turn.
  char('LNT', 'Lantern Signal', [{ kind: 'activated', timing: 'main', cost: [stock1], effect: [draw1, { do: 'power', amount: 500, target: { all: { side: 'you', other: true } } }] }], {
    color: 'red',
  }),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons: trigger checks do nothing and damage always sticks. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];
/** A deck whose top cards are told apart: B1 on top, then R0, then Y1. */
const MARKED = ['G0', 'G0', 'G0', 'G0', 'Y1', 'R0', 'B1'];

function scenario(start: ScenarioSpec['start'], p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start, players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }], ...more });
}

const mainPhase = (p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}) => scenario('main', p0, p1, more);
const attackPhase = (p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}) => scenario('attack', p0, p1, more);

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });
const orderAuto = (player: PlayerId, auto: number): Action => ({ type: 'ORDER_AUTO', player, auto });
const playChar = (player: PlayerId, card: CardId, slot: Slot): Action => ({ type: 'PLAY_CHARACTER', player, card, slot });
const playEvent = (player: PlayerId, card: CardId): Action => ({ type: 'PLAY_EVENT', player, card });
const activate = (player: PlayerId, card: CardId, ability: number): Action => ({ type: 'ACTIVATE', player, card, ability });
const swap = (player: PlayerId, a: Slot, b: Slot): Action => ({ type: 'SWAP', player, a, b });
const attack = (player: PlayerId, slot: Slot): Action => ({ type: 'ATTACK', player, slot, attack: 'frontal' });

interface Run {
  state: GameState;
  events: GameEvent[];
}

/** Applies one action and throws with the engine's reason if it is refused. */
function go(s: GameState, action: Action): Run {
  const r = applyAction(s, cat, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** Applies several actions; returns the last state and every event on the way. */
function goAll(s: GameState, ...actions: Action[]): Run {
  let state = s;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = go(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const defOf = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** The card on a stage position. */
function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const c = s.players[player].stage[slot - 1]?.[0];
  if (!c) throw new Error(`no card on player ${player}'s position ${slot}`);
  return c.id;
}

/** Definition ids on each stage position ('-' when empty), positions 1-5. */
function stageDefs(s: GameState, player: PlayerId): string[] {
  return s.players[player].stage.map((cards) => cards.map((c) => `${defOf(s, c.id)}${c.orientation === 'stand' ? '' : `(${c.orientation})`}`).join('+') || '-');
}

/** Current power of several cards, in order. */
const powers = (s: GameState, ...cards: CardId[]) => cards.map((c) => currentPower(s, cat, c));

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.player}.${e.from.zone}->${e.to.player}.${e.to.zone}`];
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
    if (e.kind === 'turnStart') return [`turnStart:${e.player}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'attack') return [`attack:${defOf(s, e.card)}:${e.attack}`];
    if (e.kind === 'battle') return [`battle:${e.reversed.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'auto') return [`auto:${e.player}:${e.ability}:${defOf(s, e.card)}`];
    if (e.kind === 'damage') return [`damage:${e.target}:${e.amount}:from:${defOf(s, e.source)}`];
    if (e.kind === 'damageCanceled') return [`canceled:${e.target}:from:${defOf(s, e.source)}`];
    if (e.kind === 'damageTaken') return [`taken:${e.target}:from:${defOf(s, e.source)}`];
    return [];
  });
}

/** The trace up to and including the first `marker`. */
function upTo(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(0, i + 1);
}

/** The trace from the first `marker` on. */
function from(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(i);
}

/** Legal actions for the player being waited on, readable and sorted. */
function offers(s: GameState): string[] {
  return legalActions(s, cat)
    .map((a) => (a.type === 'ORDER_AUTO' ? `ORDER_AUTO:${String(a.auto)}` : a.type === 'ACTIVATE' ? `ACTIVATE:${defOf(s, a.card)}#${a.ability}` : 'card' in a && typeof a.card === 'string' ? `${a.type}:${defOf(s, a.card)}` : a.type))
    .filter((x, i, all) => all.indexOf(x) === i)
    .sort();
}

/** The autoOrder prompt's options as "player:DEF#index". */
function autoOptions(s: GameState): string[] {
  const p = s.pending;
  if (p?.kind !== 'autoOrder') throw new Error(`expected an autoOrder prompt, got ${p?.kind ?? 'none'}`);
  return p.options.map((a) => (a.ability === 'card' ? `${a.player}:${defOf(s, a.source.card)}#${a.index}` : `${a.player}:${a.ability}`));
}

/** The id of the autoOrder option that is a default Encore. */
function encoreOption(s: GameState): number {
  const p = s.pending;
  if (p?.kind !== 'autoOrder') throw new Error('no autoOrder prompt');
  const o = p.options.find((a) => a.ability === 'encore');
  if (!o) throw new Error('no Encore in standby');
  return o.id;
}

/** The id of the autoOrder option whose source card is `card` and ability index `index`. */
function optionFor(s: GameState, card: CardId, index: number): number {
  const p = s.pending;
  if (p?.kind !== 'autoOrder') throw new Error('no autoOrder prompt');
  const o = p.options.find((a) => a.ability === 'card' && a.source.card === card && a.index === index);
  if (!o) throw new Error(`no standby option for ${card}#${index}`);
  return o.id;
}

describe('the synthetic catalog', () => {
  it('passes catalog validation', () => {
    expect(validateCatalog(cat)).toEqual([]);
  });
});

// =============================================================================
// ABL-06: effects active or inactive under a condition (CR 8.3.1-8.3.3)
// =============================================================================

describe('ABL-06: an effect that is active only under a condition is inactive whenever the condition is unmet', () => {
  it('[ABL-06] a conditional continuous ability gives nothing while its condition is unmet, gives its whole effect from the moment it is met (exactly the minimum), and stops again when it fails', () => {
    // WRD needs 2 of its master's characters named "Yellow Scout". Player 0 has one; the opponent's two do not count.
    const s0 = mainPhase({ stage: { 1: 'WRD', 2: 'Y0' }, hand: ['Y0b', 'R0'] }, { stage: { 1: 'Y0', 2: 'Y0b' } });
    const wrd = idAt(s0, 0, 1);
    expect([currentPower(s0, cat, wrd), currentSoul(s0, cat, wrd)]).toEqual([3000, 1]);

    // A second "Yellow Scout" (another print with that name) makes it exactly 2: the power and soul parts both apply.
    const a = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'Y0b'), 3));
    expect(stageDefs(a.state, 0)).toEqual(['WRD', 'Y0', 'Y0b', '-', '-']);
    expect([currentPower(a.state, cat, wrd), currentSoul(a.state, cat, wrd)]).toEqual([4500, 2]);
    // A continuous ability is not played and asks nothing, active or not.
    expect(trace(a.state, a.events)).toEqual(['action:PLAY_CHARACTER:0', 'played:Y0b', 'move:play:Y0b:0.hand->0.stage', 'check', 'playTiming:0:main']);

    // R0 is played onto Y0's position; the rule action removes Y0, leaving one Scout: the ability is inactive again.
    const b = go(a.state, playChar(0, cardIn(a.state, 0, 'hand', 'R0'), 2));
    expect(stageDefs(b.state, 0)).toEqual(['WRD', 'R0', 'Y0b', '-', '-']);
    expect(defsIn(b.state, 0, 'waiting')).toEqual(['Y0']);
    expect([currentPower(b.state, cat, wrd), currentSoul(b.state, cat, wrd)]).toEqual([3000, 1]);
    // The opponent's Scouts were never affected by any of this.
    expect(powers(b.state, idAt(b.state, 1, 1), idAt(b.state, 1, 2))).toEqual([2000, 2500]);
  });

  it('[ABL-06] "during your turn" and "during your opponent\'s turn" parts switch on and off as the turn passes; each is read from its own card\'s master', () => {
    // Both players have a DTY. It is player 0's turn.
    const s0 = mainPhase({ stage: { 1: 'DTY' } }, { stage: { 1: 'DTY' } });
    const mine = idAt(s0, 0, 1);
    const theirs = idAt(s0, 1, 1);
    expect(s0.active).toBe(0);
    expect([currentPower(s0, cat, mine), currentSoul(s0, cat, mine)]).toEqual([4000, 1]);
    expect([currentPower(s0, cat, theirs), currentSoul(s0, cat, theirs)]).toEqual([2000, 2]);

    // Player 0 ends the main phase, the climax phase and the Attack Phase: the turn passes to player 1.
    const r = goAll(s0, pass(0), pass(0), pass(0));
    expect(r.state.active).toBe(1);
    expect(r.state.pending).toEqual({ kind: 'clock', player: 1 });
    expect(trace(r.state, r.events)).toContain('turnStart:1');
    // The same two cards, unchanged otherwise: now the halves are the other way round.
    expect([currentPower(r.state, cat, mine), currentSoul(r.state, cat, mine)]).toEqual([2000, 2]);
    expect([currentPower(r.state, cat, theirs), currentSoul(r.state, cat, theirs)]).toEqual([4000, 1]);
  });

  it('[ABL-06] a conditional part of an automatic ability whose condition is unmet generates nothing and asks for no choice, though valid targets exist; the ability is still played and its other part still happens', () => {
    // Level 0: the "if your level is 1 or higher" part is inactive.
    const s0 = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' }, hand: ['SPT'], deck: MARKED });
    const [y0, y1] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const r = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'SPT'), 3));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:SPT',
      'move:play:SPT:0.hand->0.stage',
      'check',
      'ability:0:SPT#0:automatic',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
      'effect:0:if',
      'playTiming:0:main',
    ]);
    // No target prompt was opened and nothing was chosen or changed.
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(r.state.resolving).toBeNull();
    expect(r.events.filter((e) => e.kind === 'chosen' || e.kind === 'modifier')).toEqual([]);
    expect(powers(r.state, y0, y1)).toEqual([2000, 5000]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
  });

  it('[ABL-06] the same conditional part is active at exactly level 1: the choice is asked and the effect is generated', () => {
    const s0 = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' }, hand: ['SPT'], deck: MARKED, level: ['G0'] });
    const [y0, y1] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const a = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'SPT'), 3));
    const spt = idAt(a.state, 0, 3);
    expect(from(trace(a.state, a.events), 'ability:0:SPT#0:automatic')).toEqual(['ability:0:SPT#0:automatic', 'effect:0:draw', 'move:draw:B1:0.deck->0.hand', 'effect:0:if', 'effect:0:choose']);
    // "Other" characters: SPT itself is not an option.
    expect(a.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: spt, options: [y0, y1], picked: [], min: 1, max: 1 });

    const b = go(a.state, choose(0, y1));
    expect(trace(b.state, b.events)).toEqual(['action:CHOOSE_CARD:0', 'chosen:0:Y1', 'effect:0:power', 'mod:Y1:power+2000', 'playTiming:0:main']);
    expect(powers(b.state, y0, y1, spt)).toEqual([2000, 7000, 2000]);
  });

  it('[ABL-06] whether a conditional part is active is decided when that part would generate its effect: two abilities draw or not depending on which resolves first, and an earlier step of the same ability can switch a later part on', () => {
    const s0 = mainPhase({ hand: ['LDG'], deck: MARKED });
    const played = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'LDG'), 1));
    const ldg = idAt(played.state, 0, 1);
    // Both "when played" abilities wait in standby; with no stock yet, the player picks the order.
    expect(autoOptions(played.state)).toEqual(['0:LDG#0', '0:LDG#1']);
    expect(defsIn(played.state, 0, 'stock')).toEqual([]);

    // Conditional ability first: no stock at that moment, so its draw is inactive. Then the stock one runs.
    const condFirst = go(played.state, orderAuto(0, optionFor(played.state, ldg, 1)));
    expect(trace(condFirst.state, condFirst.events)).toEqual([
      'action:ORDER_AUTO:0',
      'ability:0:LDG#1:automatic',
      'effect:0:if',
      'ability:0:LDG#0:automatic',
      'effect:0:stockFromDeck',
      'move:effect:B1:0.deck->0.stock',
      'playTiming:0:main',
    ]);
    expect(defsIn(condFirst.state, 0, 'hand')).toEqual([]);
    expect(defsIn(condFirst.state, 0, 'stock')).toEqual(['B1']);

    // Stock ability first: by the time the conditional ability resolves its condition holds, so it draws.
    const stockFirst = go(played.state, orderAuto(0, optionFor(played.state, ldg, 0)));
    expect(trace(stockFirst.state, stockFirst.events)).toEqual([
      'action:ORDER_AUTO:0',
      'ability:0:LDG#0:automatic',
      'effect:0:stockFromDeck',
      'move:effect:B1:0.deck->0.stock',
      'ability:0:LDG#1:automatic',
      'effect:0:if',
      'effect:0:draw',
      'move:draw:R0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(defsIn(stockFirst.state, 0, 'hand')).toEqual(['R0']);
    expect(defsIn(stockFirst.state, 0, 'stock')).toEqual(['B1']);

    // One ability with both parts: the stock is empty when it starts resolving, but its first step fills it, so
    // the conditional draw that follows is active.
    const one = mainPhase({ hand: ['LDS'], deck: MARKED });
    expect(defsIn(one, 0, 'stock')).toEqual([]);
    const single = go(one, playChar(0, cardIn(one, 0, 'hand', 'LDS'), 1));
    expect(from(trace(single.state, single.events), 'ability:0:LDS#0:automatic')).toEqual([
      'ability:0:LDS#0:automatic',
      'effect:0:stockFromDeck',
      'move:effect:B1:0.deck->0.stock',
      'effect:0:if',
      'effect:0:draw',
      'move:draw:R0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(defsIn(single.state, 0, 'stock')).toEqual(['B1']);
    expect(defsIn(single.state, 0, 'hand')).toEqual(['R0']);
  });

  it('[ABL-06] [CONC-07] a condition is checked for its own ability\'s master on either player\'s turn: each side\'s count of "your" Scouts and "your level" are its own', () => {
    for (const active of [0, 1] as const) {
      // Player 0: one Scout, level 0. Player 1: two Scouts (two prints of that name), level 1.
      const s = mainPhase({ stage: { 1: 'WRD', 2: 'Y0', 3: 'NLK' } }, { stage: { 1: 'WRD', 2: 'Y0', 3: 'Y0b', 4: 'NLK' }, level: ['G0'] }, { active });
      expect(s.active).toBe(active);
      const [wrd0, nlk0, wrd1, nlk1] = [idAt(s, 0, 1), idAt(s, 0, 3), idAt(s, 1, 1), idAt(s, 1, 4)];
      // Player 0's two conditional abilities are inactive, whoever's turn it is.
      expect([currentPower(s, cat, wrd0), currentSoul(s, cat, wrd0), currentPower(s, cat, nlk0)]).toEqual([3000, 1, 2000]);
      // Player 1's are active, whoever's turn it is.
      expect([currentPower(s, cat, wrd1), currentSoul(s, cat, wrd1), currentPower(s, cat, nlk1)]).toEqual([4500, 2, 3000]);
    }
  });
});

// =============================================================================
// ABL-20: effects of non-continuous abilities apply only to the cards there when played (CR 8.9.2)
// =============================================================================

describe('ABL-20: an effect from an event, activated or automatic ability does not follow cards that change zones afterwards', () => {
  it('[ABL-20] after an event gives all of your characters +1000 until end of turn, a character played afterwards keeps its printed power', () => {
    const s0 = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' }, hand: ['RLY', 'B0'] }, { stage: { 2: 'R1' } });
    const [y0, y1, r1] = [idAt(s0, 0, 1), idAt(s0, 0, 2), idAt(s0, 1, 2)];

    const a = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'RLY')));
    expect(trace(a.state, a.events)).toEqual([
      'action:PLAY_EVENT:0',
      'played:RLY',
      'move:play:RLY:0.hand->0.resolution',
      'effect:0:power',
      'mod:Y0:power+1000',
      'mod:Y1:power+1000',
      'move:eventResolved:RLY:0.resolution->0.waiting',
      'check',
      'playTiming:0:main',
    ]);
    expect(powers(a.state, y0, y1, r1)).toEqual([3000, 6000, 4500]);

    // B0 enters the stage after the event was played: it is not one of the cards the effect applies to.
    const b0 = cardIn(a.state, 0, 'hand', 'B0');
    const b = go(a.state, playChar(0, b0, 3));
    expect(stageDefs(b.state, 0)).toEqual(['Y0', 'Y1', 'B0', '-', '-']);
    expect(b.events.filter((e) => e.kind === 'modifier')).toEqual([]);
    expect(powers(b.state, b0, y0, y1, r1)).toEqual([2500, 3000, 6000, 4500]);
  });

  it('[ABL-20] the same holds for an automatic ability: "your other characters get +1000" reaches only the characters on the stage when it was played, not one played later', () => {
    const s0 = mainPhase({ stage: { 1: 'Y0' }, hand: ['HRN', 'B0'] }, { stage: { 1: 'R0' } });
    const [y0, r0] = [idAt(s0, 0, 1), idAt(s0, 1, 1)];

    const a = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'HRN'), 2));
    const hrn = idAt(a.state, 0, 2);
    expect(trace(a.state, a.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:HRN',
      'move:play:HRN:0.hand->0.stage',
      'check',
      'ability:0:HRN#0:automatic',
      'effect:0:power',
      'mod:Y0:power+1000',
      'playTiming:0:main',
    ]);
    expect(powers(a.state, y0, hrn, r0)).toEqual([3000, 2000, 3000]);

    const b0 = cardIn(a.state, 0, 'hand', 'B0');
    const b = go(a.state, playChar(0, b0, 3));
    expect(b.events.filter((e) => e.kind === 'modifier')).toEqual([]);
    expect(powers(b.state, b0, y0, hrn)).toEqual([2500, 3000, 2000]);
  });

  it('[ABL-20] what counts is when the ability is played, not when it triggered: a character back by Encore before the waiting ability is played gets its +1000, one back after it does not', () => {
    const s0 = mainPhase({ stage: { 1: 'Y0' }, hand: ['DRM'], stock: ['G0', 'G0', 'G0'] });
    const y0 = idAt(s0, 0, 1);
    const played = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'DRM'), 2));
    const drm = idAt(played.state, 0, 2);
    expect(autoOptions(played.state)).toEqual(['0:DRM#0', '0:DRM#1']);

    // DRM#0 takes Y0 (its only other character) to 0 power; the rule action puts Y0 into the waiting room. Both
    // DRM#1, triggered when DRM was played, and Y0's Encore now wait in standby.
    const cut = go(played.state, orderAuto(0, optionFor(played.state, drm, 0)));
    expect(trace(cut.state, cut.events)).toEqual([
      'action:ORDER_AUTO:0',
      'ability:0:DRM#0:automatic',
      'effect:0:choose',
      'chosen:0:Y0',
      'effect:0:power',
      'mod:Y0:power-2000',
      'rule:insufficientPower:Y0',
      'move:ruleAction:Y0:0.stage->0.waiting',
    ]);
    expect(autoOptions(cut.state)).toEqual(['0:DRM#1', '0:encore']);

    // Encore first: Y0 is back on the stage before DRM#1 is played, so DRM#1 applies to it.
    const encoreFirst = goAll(cut.state, orderAuto(0, encoreOption(cut.state)), accept(0));
    expect(from(trace(encoreFirst.state, encoreFirst.events), 'auto:0:encore:Y0')).toEqual([
      'auto:0:encore:Y0',
      'move:encore:Y0:0.waiting->0.stage',
      'ability:0:DRM#1:automatic',
      'effect:0:power',
      'mod:Y0:power+1000',
      'playTiming:0:main',
    ]);
    expect(stageDefs(encoreFirst.state, 0)).toEqual(['Y0(rest)', 'DRM', '-', '-', '-']);
    expect(powers(encoreFirst.state, y0, drm)).toEqual([3000, 2000]);

    // DRM#1 first: it is played while Y0 is in the waiting room and affects nobody; Y0 then comes back after it was played.
    const abilityFirst = goAll(cut.state, orderAuto(0, optionFor(cut.state, drm, 1)), accept(0));
    expect(trace(abilityFirst.state, abilityFirst.events)).toEqual([
      'action:ORDER_AUTO:0',
      'ability:0:DRM#1:automatic',
      'effect:0:power',
      'action:ACCEPT:0',
      'move:cost:G0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'auto:0:encore:Y0',
      'move:encore:Y0:0.waiting->0.stage',
      'playTiming:0:main',
    ]);
    expect(stageDefs(abilityFirst.state, 0)).toEqual(['Y0(rest)', 'DRM', '-', '-', '-']);
    expect(powers(abilityFirst.state, y0, drm)).toEqual([2000, 2000]);
  });

  it('[ABL-20] a character that leaves the stage and is played again is a new card: the event\'s +1000 and an activated ability\'s +1500 with no stated duration no longer apply to it', () => {
    const s0 = mainPhase({ stage: { 1: 'HOP', 2: 'Y1' }, stock: ['G0', 'G0'], hand: ['RLY'] });
    const [hop, y1] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];

    const boosted = goAll(s0, playEvent(0, cardIn(s0, 0, 'hand', 'RLY')), activate(0, hop, 0));
    expect(trace(boosted.state, boosted.events)).toContain('mod:HOP:power+1500');
    expect(powers(boosted.state, hop, y1)).toEqual([4500, 6000]);
    const epoch = boosted.state.cards[hop]?.epoch ?? -1;

    // HOP returns itself to the hand: it changed zones after both abilities were played.
    const back = go(boosted.state, activate(0, hop, 1));
    expect(trace(back.state, back.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:HOP#1:activated',
      'effect:0:returnToHand',
      'move:effect:HOP:0.stage->0.hand',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(back.state, 0, 'hand')).toEqual(['HOP']);
    expect(currentPower(back.state, cat, hop)).toBe(2000);

    // Played again on the same position: printed power. Y1, which never moved, keeps the event's +1000.
    const again = go(back.state, playChar(0, hop, 1));
    expect(stageDefs(again.state, 0)).toEqual(['HOP', 'Y1', '-', '-', '-']);
    expect(again.state.cards[hop]?.epoch).toBe(epoch + 2);
    expect(again.events.filter((e) => e.kind === 'modifier')).toEqual([]);
    expect(powers(again.state, hop, y1)).toEqual([2000, 6000]);
  });

  it('[ABL-20] moving between stage positions is not a zone change: an until-end-of-turn effect and one with no stated duration both stay with characters that swap or move to an empty position', () => {
    const s0 = mainPhase({ stage: { 1: 'HOP', 2: 'Y1' }, stock: ['G0'], hand: ['RLY'] });
    const [hop, y1] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const boosted = goAll(s0, playEvent(0, cardIn(s0, 0, 'hand', 'RLY')), activate(0, hop, 0)).state;
    expect(powers(boosted, hop, y1)).toEqual([4500, 6000]);
    const epochs = [boosted.cards[hop]?.epoch, boosted.cards[y1]?.epoch];

    // Swap the two characters.
    const a = go(boosted, swap(0, 1, 2));
    expect(trace(a.state, a.events)).toEqual(['action:SWAP:0', 'move:swap:HOP:0.stage->0.stage', 'move:swap:Y1:0.stage->0.stage', 'check', 'playTiming:0:main']);
    expect(stageDefs(a.state, 0)).toEqual(['Y1', 'HOP', '-', '-', '-']);
    expect(powers(a.state, hop, y1)).toEqual([4500, 6000]);

    // Move HOP from center stage to an empty back stage position.
    const b = go(a.state, swap(0, 2, 5));
    expect(stageDefs(b.state, 0)).toEqual(['Y1', '-', '-', '-', 'HOP']);
    expect(locate(b.state, hop)).toMatchObject({ player: 0, zone: 'stage', slot: 5 });
    expect(powers(b.state, hop, y1)).toEqual([4500, 6000]);
    expect([b.state.cards[hop]?.epoch, b.state.cards[y1]?.epoch]).toEqual(epochs);
  });
});

// =============================================================================
// ABL-21: a continuous effect on a zone applies to a card the instant it enters (CR 8.9.3)
// =============================================================================

describe('ABL-21: a continuous effect on the cards in a zone applies to a card the moment it enters that zone', () => {
  it('[ABL-21] a "your other characters get +1000" ability applies to a character as it is played, so a 0-power character survives the check timing that follows; without it, that character is removed', () => {
    const s0 = mainPhase({ stage: { 1: 'AUR' }, hand: ['Z0', 'B0'] }, { stage: { 1: 'R0' } });
    const aur = idAt(s0, 0, 1);
    const [z0, b0] = [cardIn(s0, 0, 'hand', 'Z0'), cardIn(s0, 0, 'hand', 'B0')];
    // In the hand they are not in the affected zone.
    expect(powers(s0, z0, b0)).toEqual([0, 2500]);

    const a = go(s0, playChar(0, z0, 2));
    // The check timing right after the play finds 1000 power, not 0: no rule action.
    expect(trace(a.state, a.events)).toEqual(['action:PLAY_CHARACTER:0', 'played:Z0', 'move:play:Z0:0.hand->0.stage', 'check', 'playTiming:0:main']);
    expect(stageDefs(a.state, 0)).toEqual(['AUR', 'Z0', '-', '-', '-']);
    expect(currentPower(a.state, cat, z0)).toBe(1000);

    // Unlike a one-shot effect, it also reaches the next character played, and nothing is logged for it.
    const b = go(a.state, playChar(0, b0, 3));
    expect(b.events.filter((e) => e.kind === 'modifier')).toEqual([]);
    expect(powers(b.state, aur, z0, b0, idAt(b.state, 1, 1))).toEqual([2000, 1000, 3500, 3000]);

    // Control: with no such ability on the stage, the same 0-power character is put into the waiting room at once.
    const c0 = mainPhase({ stage: { 1: 'Y0' }, hand: ['Z0'] });
    const c = go(c0, playChar(0, cardIn(c0, 0, 'hand', 'Z0'), 2));
    expect(trace(c.state, c.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:Z0',
      'move:play:Z0:0.hand->0.stage',
      'check',
      'rule:insufficientPower:Z0',
      'move:ruleAction:Z0:0.stage->0.waiting',
      'playTiming:0:main',
    ]);
  });

  it('[ABL-21] the opponent\'s "-1000 to your opponent\'s characters" applies as a character enters: a 1000-power character is at 0 and goes to the waiting room in the very next check timing', () => {
    const s0 = mainPhase({ hand: ['FRL', 'B0'] }, { stage: { 2: 'HEX' } });
    const hex = idAt(s0, 1, 2);
    const frl = cardIn(s0, 0, 'hand', 'FRL');
    const a = go(s0, playChar(0, frl, 1));
    expect(trace(a.state, a.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:FRL',
      'move:play:FRL:0.hand->0.stage',
      'check',
      'rule:insufficientPower:FRL',
      'move:ruleAction:FRL:0.stage->0.waiting',
      'playTiming:0:main',
    ]);
    expect(defsIn(a.state, 0, 'waiting')).toEqual(['FRL']);
    // Out of the stage, the effect no longer applies to it.
    expect(currentPower(a.state, cat, frl)).toBe(1000);

    // A stronger character stays, with the effect applied; HEX itself is not affected.
    const b0 = cardIn(a.state, 0, 'hand', 'B0');
    const b = go(a.state, playChar(0, b0, 1));
    expect(stageDefs(b.state, 0)).toEqual(['B0', '-', '-', '-', '-']);
    expect(powers(b.state, b0, hex)).toEqual([1500, 3000]);

    // Control: without HEX the 1000-power character stays.
    const c0 = mainPhase({ hand: ['FRL'] }, { stage: { 2: 'R1' } });
    const c = go(c0, playChar(0, cardIn(c0, 0, 'hand', 'FRL'), 1));
    expect(stageDefs(c.state, 0)).toEqual(['FRL', '-', '-', '-', '-']);
  });

  it('[ABL-21] [ABL-20] a character that comes back by Encore gets the continuous ability\'s +1000 the moment it is back, but not the +1000 of the event played before it left', () => {
    const s0 = mainPhase({ stage: { 1: 'FLD', 2: 'AUR' }, stock: ['G0', 'G0', 'G0'], hand: ['RLY'] });
    const [fld, aur] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const a = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'RLY')));
    expect(powers(a.state, fld, aur)).toEqual([4000, 3000]);

    // FLD puts itself into the waiting room as its cost; the default Encore is offered in the next check timing.
    const b = go(a.state, activate(0, fld, 0));
    expect(trace(b.state, b.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:FLD:0.stage->0.waiting',
      'ability:0:FLD#0:activated',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'check',
    ]);
    expect(b.state.pending).toEqual({ kind: 'encore', player: 0, card: fld, slot: 1, cost: 3 });

    const c = go(b.state, accept(0));
    expect(trace(c.state, c.events)).toEqual([
      'action:ACCEPT:0',
      'move:cost:G0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'auto:0:encore:FLD',
      'move:encore:FLD:0.waiting->0.stage',
      'playTiming:0:main',
    ]);
    expect(stageDefs(c.state, 0)).toEqual(['FLD(rest)', 'AUR', '-', '-', '-']);
    // 2000 printed + 1000 from AUR; the event's +1000 stayed with the card object that left.
    expect(powers(c.state, fld, aur)).toEqual([3000, 3000]);
  });
});

// =============================================================================
// CONC-07: an effect's master is whoever masters the ability it came from (CR 4.3.3)
// =============================================================================

describe('CONC-07: an effect belongs to the master of the ability that generated it', () => {
  it('[CONC-07] an automatic ability of the non-turn player\'s character, triggered in the turn player\'s battle, generates effects mastered by the non-turn player: they choose among their own characters, draw from their own deck, and damage the turn player', () => {
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'BRT' } }, { stage: { 1: 'R0', 2: 'MRR', 3: 'R1' }, deck: MARKED });
    const [y0, brt] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const [r0, mrr, r1] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];
    const clock0 = s0.players[0].clock.length;

    // BRT (5000) attacks MRR (1000) head on; the opponent passes in the Counter Step; MRR is reversed in battle.
    const a = goAll(s0, attack(0, 2), pass(1));
    expect(a.state.active).toBe(0);
    expect(trace(a.state, a.events)).toContain('battle:MRR');
    expect(from(trace(a.state, a.events), 'battle:MRR')).toEqual(['battle:MRR', 'check', 'ability:1:MRR#0:automatic', 'effect:1:choose']);
    expect(a.state.resolving?.master).toBe(1);
    // "Your other characters" are player 1's, not MRR itself and nothing of the turn player's.
    expect(a.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'target', card: mrr, options: [r0, r1], picked: [], min: 1, max: 1 });

    const b = go(a.state, choose(1, r1));
    expect(upTo(trace(b.state, b.events), 'taken:0:from:MRR')).toEqual([
      'action:CHOOSE_CARD:1',
      'chosen:1:R1',
      'effect:1:power',
      'mod:R1:power+1000',
      'effect:1:draw',
      'move:draw:B1:1.deck->1.hand',
      'effect:1:damageOpp',
      'damage:0:1:from:MRR',
      'move:damage:G0:0.deck->0.resolution',
      'move:damageToClock:G0:0.resolution->0.clock',
      'taken:0:from:MRR',
    ]);
    expect(powers(b.state, r0, r1, y0, brt)).toEqual([3000, 5500, 2000, 5000]);
    expect(defsIn(b.state, 1, 'hand')).toEqual(['B1']);
    expect(defsIn(b.state, 0, 'hand')).toEqual([]);
    expect(b.state.players[0].clock.length).toBe(clock0 + 1);
    expect(defsIn(b.state, 1, 'clock')).toEqual([]);
  });

  it('[CONC-07] a continuous ability\'s effects are its card\'s master\'s: "your" and "your opponent\'s" are read from that player, whoever\'s turn it is; two copies on opposite sides each follow their own master, and a copy owned by the opponent follows whoever has it on their stage', () => {
    for (const active of [0, 1] as const) {
      // Only player 1 has CHR.
      const s = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' } }, { stage: { 1: 'CHR', 2: 'R1' } }, { active });
      expect(s.active).toBe(active);
      expect(powers(s, idAt(s, 0, 1), idAt(s, 0, 2), idAt(s, 1, 1), idAt(s, 1, 2))).toEqual([1500, 4500, 2000, 5500]);
    }
    // One CHR each: each gives its own master's other characters +1000 and the other side -500.
    const both = mainPhase({ stage: { 1: 'CHR', 2: 'Y1' } }, { stage: { 1: 'CHR', 2: 'R1' } });
    expect(powers(both, idAt(both, 0, 1), idAt(both, 0, 2), idAt(both, 1, 1), idAt(both, 1, 2))).toEqual([1500, 5500, 1500, 5000]);

    // A CHR that player 1 owns, put on player 0's stage below the action API: its master is player 0, so player 0's
    // other character gets +1000 and player 1's gets -500. Player 1, its owner, gains nothing from it.
    const lent = ops.deepClone(mainPhase({ stage: { 2: 'Y1' } }, { stage: { 2: 'R1' }, hand: ['CHR'] }));
    const chr = cardIn(lent, 1, 'hand', 'CHR');
    ops.moveCard(lent, chr, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    expect(lent.cards[chr]?.owner).toBe(1);
    expect(powers(lent, chr, idAt(lent, 0, 2), idAt(lent, 1, 2))).toEqual([2000, 6000, 4000]);
  });

  it('[CONC-07] an automatic ability\'s effects belong to whoever is master of its card, not its owner: player 1\'s card played by player 0 boosts player 0\'s other characters', () => {
    const base = mainPhase({ stage: { 2: 'Y1' } }, { stage: { 2: 'R1' }, hand: ['HRN'] });
    const s0 = ops.deepClone(base);
    const hrn = cardIn(s0, 1, 'hand', 'HRN');
    ops.moveCard(s0, hrn, { player: 0, zone: 'hand' }, 'effect');
    expect(s0.cards[hrn]?.owner).toBe(1);
    const [y1, r1] = [idAt(s0, 0, 2), idAt(s0, 1, 2)];

    const r = go(s0, playChar(0, hrn, 1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:HRN',
      'move:play:HRN:0.hand->0.stage',
      'check',
      'ability:0:HRN#0:automatic',
      'effect:0:power',
      'mod:Y1:power+1000',
      'playTiming:0:main',
    ]);
    expect(powers(r.state, hrn, y1, r1)).toEqual([2000, 6000, 4500]);
  });

  it('[CONC-07] a counter event played by the non-turn player has them as master: they choose among their own characters and they draw', () => {
    // Y0 can still attack afterwards, so the run stops at player 0's next declaration.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'BRT' } }, { stage: { 1: 'R0', 2: 'R1' }, hand: ['GRD'], deck: MARKED });
    const brt = idAt(s0, 0, 2);
    const [r0, r1] = [idAt(s0, 1, 1), idAt(s0, 1, 2)];
    const counter = go(s0, attack(0, 2)).state;
    expect(counter.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(offers(counter)).toContain('PLAY_EVENT:GRD');

    const a = go(counter, playEvent(1, cardIn(counter, 1, 'hand', 'GRD')));
    expect(trace(a.state, a.events)).toEqual(['action:PLAY_EVENT:1', 'played:GRD', 'move:play:GRD:1.hand->1.resolution', 'effect:1:choose']);
    expect(a.state.pending).toMatchObject({ kind: 'pick', player: 1, purpose: 'target', options: [r0, r1], min: 1, max: 1 });

    const b = go(a.state, choose(1, r1));
    expect(upTo(trace(b.state, b.events), 'move:eventResolved:GRD:1.resolution->1.waiting')).toEqual([
      'action:CHOOSE_CARD:1',
      'chosen:1:R1',
      'effect:1:power',
      'mod:R1:power+2000',
      'effect:1:draw',
      'move:draw:B1:1.deck->1.hand',
      'move:eventResolved:GRD:1.resolution->1.waiting',
    ]);
    expect(b.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(b.state, 1, 'hand')).toEqual(['B1']);
    expect(defsIn(b.state, 0, 'hand')).toEqual([]);
    // R1 (6500) now beats the attacker (5000) in the battle.
    expect(powers(b.state, r0, r1, brt)).toEqual([3000, 6500, 5000]);
    expect(trace(b.state, b.events)).toContain('battle:BRT');
  });

  it('[CONC-07] the effect\'s master is the ability\'s master, not the card\'s owner: player 1\'s card on player 0\'s stage, used by player 0, draws for player 0 and boosts player 0\'s characters', () => {
    const base = mainPhase({ stage: { 2: 'Y1' }, stock: ['G0'], deck: MARKED }, { stage: { 2: 'R1' }, hand: ['LNT'], stock: ['R0'] });
    const s0 = ops.deepClone(base);
    const lnt = cardIn(s0, 1, 'hand', 'LNT');
    ops.moveCard(s0, lnt, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    expect(s0.cards[lnt]?.owner).toBe(1);
    expect(offers(s0)).toContain('ACTIVATE:LNT#0');

    const r = go(s0, activate(0, lnt, 0));
    expect(trace(r.state, r.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:LNT#0:activated',
      'effect:0:draw',
      'move:draw:B1:0.deck->0.hand',
      'effect:0:power',
      'mod:Y1:power+500',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
    expect(defsIn(r.state, 1, 'hand')).toEqual([]);
    expect(defsIn(r.state, 1, 'stock')).toEqual(['R0']);
    expect(powers(r.state, idAt(r.state, 0, 2), idAt(r.state, 1, 2), lnt)).toEqual([5500, 4500, 2000]);
  });
});
