// Rule tests for M3: choices inside card effects (CR 8.6.3 and 8.6.3.1.1-8.6.3.1.4),
// "you may ... if you do ... if you do not" (CR 8.6.4, 8.6.4.1) and who carries out
// an effect's actions (CR 8.6.5).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, cardText, currentPower, currentSoul, legalActions, locate, validate, validateCatalog } from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot, Step } from '../../src/engine';
import { cardIn, defsIn, makeState } from '../../src/engine/testkit';
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

/** A level 0, cost 0 yellow event with the given effect. */
const event = (id: string, name: string, effect: Step[], more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'event',
  color: 'yellow',
  level: 0,
  cost: 0,
  effect,
  ...more,
});

const onPlay = (effect: Step[]): Ability => ({ kind: 'automatic', trigger: { on: 'play' }, effect });
const draw1: Step = { do: 'draw', count: 1 };
/** Choose `count` of your opponent's characters as `as`; they get `amount` power. */
const markOpp = (as: string, count: number, amount: number, upTo = false): Step[] => [
  upTo ? { do: 'choose', as, count, upTo: true, what: { side: 'opponent' } } : { do: 'choose', as, count, what: { side: 'opponent' } },
  { do: 'power', amount, target: { ref: as } },
];
/** Every level 0 character of your opponent goes to the waiting room. */
const wipeLevel0: Step = { do: 'sendToWaiting', target: { all: { side: 'opponent', level: { max: 0 } } } };

const extra: CardDef[] = [
  // PLAY-09
  // [ACT] [(1), rest this] Choose 1 of your opponent's characters. It gets -1000 power.
  char('SNP', 'Lantern Sniper', [{ kind: 'activated', timing: 'main', cost: [{ pay: 'stock', count: 1 }, { pay: 'rest' }], effect: markOpp('mark', 1, -1000) }]),
  // Put all your opponent's level 0 characters into the waiting room. Then choose 1 of your opponent's characters; it gets -1000 power.
  event('PRG', 'Clearing Signal', [wipeLevel0, ...markOpp('mark', 1, -1000)]),
  // Two abilities that trigger together: [0] the level 0 wipe; [1] choose 1 of your opponent's characters, -1000 power.
  char('DUO', 'Dusk Duelist', [onPlay([wipeLevel0]), onPlay(markOpp('mark', 1, -1000))]),
  // [ACT] [put this card into your waiting room] Choose 1 of your characters. It gets +1000 power.
  char('SAC', 'Ember Relay', [
    {
      kind: 'activated',
      timing: 'main',
      cost: [{ pay: 'selfToWaiting' }],
      effect: [
        { do: 'choose', as: 'ally', count: 1, what: { side: 'you' } },
        { do: 'power', amount: 1000, target: { ref: 'ally' } },
      ],
    },
  ]),

  // PLAY-10
  // Choose 2 of your opponent's characters; they get -1000 power. Draw a card.
  event('PIN', 'Twin Pin', [...markOpp('pair', 2, -1000), draw1]),
  // Return 1 character from your waiting room to your hand.
  event('SLV', 'Ash Recall', [{ do: 'salvage', count: 1, filter: { kind: 'character' } }]),
  // Discard 2 cards.
  event('DRP', 'Double Drop', [{ do: 'discard', count: 2 }]),
  // Choose 1 of your opponent's blue characters. It gets -1000 power.
  event('BLU', 'Azure Pin', [
    { do: 'choose', as: 'blue', count: 1, what: { side: 'opponent', color: 'blue' } },
    { do: 'power', amount: -1000, target: { ref: 'blue' } },
  ]),

  // PLAY-11
  // Choose up to 2 of your opponent's characters; they get -1000 power. Draw a card.
  event('UPT', 'Loose Net', [...markOpp('net', 2, -1000, true), draw1]),
  // Return up to 2 cards from your waiting room to your hand.
  event('UPS', 'Gentle Recall', [{ do: 'salvage', count: 2, upTo: true }]),
  // Discard up to 2 cards.
  event('UPD', 'Light Shed', [{ do: 'discard', count: 2, upTo: true }]),
  // Look at the top 2 cards of your deck, put up to 1 of them into your hand; the rest go to the waiting room.
  event('UPL', 'Idle Glance', [{ do: 'lookTop', count: 2, take: { count: 1, upTo: true, to: 'hand' }, rest: 'waiting' }]),

  // PLAY-12
  // Discard 1 blue card.
  event('SFT', 'Tide Sift', [{ do: 'discard', count: 1, filter: { color: 'blue' } }]),
  // Discard 1 card.
  event('DIS', 'Plain Toss', [{ do: 'discard', count: 1 }]),
  // Look at the top 3 cards of your deck, choose 1 character among them and put it into your hand; the rest go to the waiting room.
  event('SCN', 'Deep Scan', [{ do: 'lookTop', count: 3, take: { count: 1, filter: { kind: 'character' }, to: 'hand' }, rest: 'waiting' }]),
  // The same with no condition on the card taken.
  event('SCU', 'Blind Scan', [{ do: 'lookTop', count: 3, take: { count: 1, to: 'hand' }, rest: 'waiting' }]),
  // Your opponent discards 1 blue card.
  event('OPD', 'Tide Tax', [{ do: 'discard', count: 1, player: 'opponent', filter: { color: 'blue' } }]),

  // PLAY-13
  // [AUTO] When played: you may put the top card of your clock into your waiting room. If you do, this gets +1000 power.
  // If you do not, this gets +1 soul. Then draw a card.
  char('FER', 'Quiet Ferryman', [
    onPlay([
      {
        do: 'may',
        steps: [{ do: 'heal', count: 1 }],
        then: [{ do: 'power', amount: 1000, target: 'this' }],
        else: [{ do: 'soul', amount: 1, target: 'this' }],
      },
      draw1,
    ]),
  ]),
  // You may discard 2 cards. If you do, put the top 2 cards of your deck into your stock. If you do not, draw a card.
  event('TWO', 'Twofold Offering', [{ do: 'may', steps: [{ do: 'discard', count: 2 }], then: [{ do: 'stockFromDeck', count: 2 }], else: [draw1] }]),
  // You may discard 1 blue card. If you do, put the top 2 cards of your deck into your stock. If you do not, draw a card.
  event('BLD', 'Blue Tithe', [
    { do: 'may', steps: [{ do: 'discard', count: 1, filter: { color: 'blue' } }], then: [{ do: 'stockFromDeck', count: 2 }], else: [draw1] },
  ]),
  // You may choose 1 of your opponent's characters. If you do, it gets -2000 power. If you do not, draw a card.
  event('MCH', 'Hesitant Mark', [
    { do: 'may', steps: [{ do: 'choose', as: 'mark', count: 1, what: { side: 'opponent' } }], then: [{ do: 'power', amount: -2000, target: { ref: 'mark' } }], else: [draw1] },
  ]),

  // PLAY-14
  // [AUTO] When this card becomes reversed: draw a card; choose 1 of your characters, it gets +1000 power; you may put the top
  // card of your clock into your waiting room; your opponent draws a card; your opponent discards a card.
  char(
    'WRD',
    'Ward Sentry',
    [
      {
        kind: 'automatic',
        trigger: { on: 'reversed' },
        effect: [
          draw1,
          { do: 'choose', as: 'ally', count: 1, what: { side: 'you' } },
          { do: 'power', amount: 1000, target: { ref: 'ally' } },
          { do: 'may', steps: [{ do: 'heal', count: 1 }] },
          { do: 'draw', count: 1, player: 'opponent' },
          { do: 'discard', count: 1, player: 'opponent' },
        ],
      },
    ],
    { color: 'red' },
  ),
  // [COUNTER] Choose 1 of your characters; it gets +2000 power. Draw a card.
  event('RCE', 'Bulwark Call', [{ do: 'choose', as: 'ally', count: 1, what: { side: 'you' } }, { do: 'power', amount: 2000, target: { ref: 'ally' } }, draw1], {
    color: 'red',
    counter: true,
  }),
  // [COUNTER] Return 1 card from your waiting room to your hand. Put the top card of your deck into your stock.
  event('RCS', 'Rally Call', [{ do: 'salvage', count: 1 }, { do: 'stockFromDeck', count: 1 }], { color: 'red', counter: true }),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

function scenario(start: ScenarioSpec['start'], p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start, players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }], ...more });
}

/** Player 0's Main Phase. */
const mainPhase = (p0: ZoneSpec, p1: ZoneSpec = {}) => scenario('main', p0, p1);
/** Player 0's Attack Phase. */
const attackPhase = (p0: ZoneSpec, p1: ZoneSpec = {}) => scenario('attack', p0, p1);

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });
const orderAuto = (player: PlayerId, auto: number): Action => ({ type: 'ORDER_AUTO', player, auto });
const playChar = (player: PlayerId, card: CardId, slot: Slot): Action => ({ type: 'PLAY_CHARACTER', player, card, slot });
const playEvent = (player: PlayerId, card: CardId): Action => ({ type: 'PLAY_EVENT', player, card });
const activate = (player: PlayerId, card: CardId, ability: number): Action => ({ type: 'ACTIVATE', player, card, ability });
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

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.player}.${e.from.zone}->${e.to.player}.${e.to.zone}`];
    if (e.kind === 'orientation') return [`${e.orientation}:${defOf(s, e.card)}`];
    if (e.kind === 'played') return [`played:${defOf(s, e.card)}`];
    if (e.kind === 'ability') return [`ability:${e.player}:${defOf(s, e.card)}#${String(e.index)}:${e.category}`];
    if (e.kind === 'effect') return [`effect:${e.player}:${e.op}`];
    if (e.kind === 'modifier') return [`mod:${defOf(s, e.card)}:${e.stat}${e.amount > 0 ? '+' : ''}${e.amount}`];
    if (e.kind === 'optional') return [`optional:${e.player}:${e.purpose}:${e.accepted}`];
    if (e.kind === 'chosen') return [`chosen:${e.player}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'look') return [`look:${e.player}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'lookEnd') return [`lookEnd:${e.player}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'battle') return [`battle:${e.reversed.map((c) => defOf(s, c)).join(',')}`];
    return [];
  });
}

/** Only the trace entries with one of these prefixes. */
const only = (t: readonly string[], ...prefixes: string[]) => t.filter((x) => prefixes.some((p) => x.startsWith(p)));

/** The trace from the first `marker` on. */
function from(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(i);
}

/** Legal actions for the player being waited on, readable and sorted. */
function offers(s: GameState): string[] {
  return legalActions(s, cat)
    .map((a) => ('card' in a && typeof a.card === 'string' ? `${a.type}:${defOf(s, a.card)}` : a.type))
    .filter((x, i, all) => all.indexOf(x) === i)
    .sort();
}

type PickPrompt = Extract<NonNullable<GameState['pending']>, { kind: 'pick' }>;

/** The open pick prompt (throws if the game is waiting on something else). */
function pickOf(s: GameState): PickPrompt {
  const p = s.pending;
  if (p?.kind !== 'pick') throw new Error(`expected a pick prompt, got ${p?.kind ?? 'none'}`);
  return p;
}

/** The id of the autoOrder option for ability `index` of `card`. */
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
// PLAY-09: "choose" happens during resolution, among what is there at that point (CR 8.6.3)
// =============================================================================

describe('PLAY-09: targets are chosen while the effect resolves, from what exists when the instruction is reached', () => {
  it('[PLAY-09] an activated ability asks for its target only after its cost is paid and it counts as played, offering the characters on the stage at that moment', () => {
    const s0 = mainPhase({ stage: { 1: 'SNP' }, stock: ['G0', 'G0'] }, { stage: { 1: 'Y0', 3: 'B1' } });
    const snp = idAt(s0, 0, 1);
    const y0 = idAt(s0, 1, 1);
    const b1 = idAt(s0, 1, 3);

    const r = go(s0, activate(0, snp, 0));
    // Cost, then "played", then the effect reaches the choose instruction and only now asks.
    expect(trace(r.state, r.events)).toEqual(['action:ACTIVATE:0', 'move:cost:G0:0.stock->0.waiting', 'rest:SNP', 'ability:0:SNP#0:activated', 'effect:0:choose']);
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: snp, options: [y0, b1], picked: [], min: 1, max: 1 });
    expect(r.state.resolving?.source.card).toBe(snp);

    const done = go(r.state, choose(0, b1));
    expect(trace(done.state, done.events)).toEqual(['action:CHOOSE_CARD:0', 'chosen:0:B1', 'effect:0:power', 'mod:B1:power-1000', 'check', 'playTiming:0:main']);
    expect(currentPower(done.state, cat, b1)).toBe(4500);
    expect(currentPower(done.state, cat, y0)).toBe(2000);
  });

  it('[PLAY-09] an event chooses while it sits in the resolution zone, after its earlier steps: a character those steps removed is not among the options', () => {
    const s0 = mainPhase({ hand: ['PRG'] }, { stage: { 1: 'Y0', 2: 'B1', 3: 'R1' } });
    const prg = cardIn(s0, 0, 'hand', 'PRG');
    const y0 = idAt(s0, 1, 1);
    const b1 = idAt(s0, 1, 2);
    const r1 = idAt(s0, 1, 3);

    const r = go(s0, playEvent(0, prg));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT:0',
      'played:PRG',
      'move:play:PRG:0.hand->0.resolution',
      'effect:0:sendToWaiting',
      'move:effect:Y0:1.stage->1.waiting',
      'effect:0:choose',
    ]);
    // Y0 was on the stage when the event was played but is gone when the choice is reached.
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: prg, options: [b1, r1], picked: [], min: 1, max: 1 });
    expect(attempt(r.state, choose(0, y0))).toBe('ILLEGAL_ACTION');
    expect(locate(r.state, prg)?.zone).toBe('resolution');

    const done = go(r.state, choose(0, r1));
    expect(only(trace(done.state, done.events), 'chosen', 'mod', 'move')).toEqual(['chosen:0:R1', 'mod:R1:power-1000', 'move:eventResolved:PRG:0.resolution->0.waiting']);
    expect(currentPower(done.state, cat, r1)).toBe(3500);
    expect(currentPower(done.state, cat, b1)).toBe(5500);
  });

  it('[PLAY-09] two abilities that triggered together: the choosing one sees the stage as it is when it resolves, not as it was when it triggered', () => {
    const s0 = mainPhase({ hand: ['DUO'] }, { stage: { 1: 'Y0', 2: 'B1', 3: 'R1' } });
    const duo = cardIn(s0, 0, 'hand', 'DUO');
    const y0 = idAt(s0, 1, 1);
    const b1 = idAt(s0, 1, 2);
    const r1 = idAt(s0, 1, 3);
    const played = go(s0, playChar(0, duo, 1));
    expect(played.state.pending?.kind).toBe('autoOrder');

    // Wipe first: by the time the choose ability resolves, Y0 has left the stage.
    const wipeFirst = go(played.state, orderAuto(0, optionFor(played.state, duo, 0)));
    expect(only(trace(wipeFirst.state, wipeFirst.events), 'ability', 'move')).toEqual([
      'ability:0:DUO#0:automatic',
      'move:effect:Y0:1.stage->1.waiting',
      'ability:0:DUO#1:automatic',
    ]);
    expect(pickOf(wipeFirst.state)).toMatchObject({ player: 0, purpose: 'target', card: duo, options: [b1, r1], min: 1, max: 1 });

    // Choose first: Y0 is still there and can be chosen.
    const chooseFirst = go(played.state, orderAuto(0, optionFor(played.state, duo, 1)));
    expect(pickOf(chooseFirst.state)).toMatchObject({ player: 0, purpose: 'target', card: duo, options: [y0, b1, r1], min: 1, max: 1 });
    const after = go(chooseFirst.state, choose(0, y0));
    expect(only(trace(after.state, after.events), 'chosen', 'mod', 'ability', 'move:effect')).toEqual([
      'chosen:0:Y0',
      'mod:Y0:power-1000',
      'ability:0:DUO#0:automatic',
      'move:effect:Y0:1.stage->1.waiting',
    ]);
  });

  it('[PLAY-09] a cost that sends the card itself to the waiting room is paid before the choice, so the options no longer include that card', () => {
    const s0 = mainPhase({ stage: { 1: 'SAC', 2: 'Y0', 3: 'B1' } });
    const [sac, y0, b1] = [idAt(s0, 0, 1), idAt(s0, 0, 2), idAt(s0, 0, 3)];

    const r = go(s0, activate(0, sac, 0));
    expect(only(trace(r.state, r.events), 'move', 'ability', 'effect')).toEqual(['move:cost:SAC:0.stage->0.waiting', 'ability:0:SAC#0:activated', 'effect:0:choose']);
    // SAC was one of "your characters" when the ability was activated, but not when the choice is reached.
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: sac, options: [y0, b1], picked: [], min: 1, max: 1 });
    expect(attempt(r.state, choose(0, sac))).toBe('ILLEGAL_ACTION');

    const done = go(r.state, choose(0, b1));
    expect(only(trace(done.state, done.events), 'chosen', 'mod')).toEqual(['chosen:0:B1', 'mod:B1:power+1000']);
    expect(currentPower(done.state, cat, b1)).toBe(6500);
    expect(currentPower(done.state, cat, y0)).toBe(2000);
  });
});

// =============================================================================
// PLAY-10: a fixed number must be chosen as far as possible (CR 8.6.3.1, 8.6.3.1.2, 8.6.3.1.3)
// =============================================================================

describe('PLAY-10: a fixed number of targets must be chosen as far as possible', () => {
  it('[PLAY-10] "choose 2" with three candidates: PASS is refused until two are picked, and the second pick closes the choice', () => {
    const s0 = mainPhase({ hand: ['PIN'] }, { stage: { 1: 'Y0', 2: 'B1', 3: 'R1' } });
    const pin = cardIn(s0, 0, 'hand', 'PIN');
    const y0 = idAt(s0, 1, 1);
    const b1 = idAt(s0, 1, 2);
    const r1 = idAt(s0, 1, 3);

    const r = go(s0, playEvent(0, pin));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: pin, options: [y0, b1, r1], picked: [], min: 2, max: 2 });
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:B1', 'CHOOSE_CARD:R1', 'CHOOSE_CARD:Y0']);
    expect(attempt(r.state, pass(0))).toBe('ILLEGAL_ACTION');

    const one = go(r.state, choose(0, y0));
    expect(one.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: pin, options: [b1, r1], picked: [y0], min: 2, max: 2 });
    expect(offers(one.state)).toEqual(['CHOOSE_CARD:B1', 'CHOOSE_CARD:R1']);
    expect(attempt(one.state, pass(0))).toBe('ILLEGAL_ACTION');
    // The same character cannot fill both picks.
    expect(attempt(one.state, choose(0, y0))).toBe('ILLEGAL_ACTION');

    const two = go(one.state, choose(0, r1));
    expect(trace(two.state, two.events)).toEqual([
      'action:CHOOSE_CARD:0',
      'chosen:0:Y0,R1',
      'effect:0:power',
      'mod:Y0:power-1000',
      'mod:R1:power-1000',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'move:eventResolved:PIN:0.resolution->0.waiting',
      'check',
      'playTiming:0:main',
    ]);
    expect([currentPower(two.state, cat, y0), currentPower(two.state, cat, b1), currentPower(two.state, cat, r1)]).toEqual([1000, 5500, 3500]);
  });

  it('[PLAY-10] "choose 2" with only one candidate: that one is chosen, with no prompt, and the effect applies to it', () => {
    const s0 = mainPhase({ hand: ['PIN'] }, { stage: { 2: 'B1' } });
    const b1 = idAt(s0, 1, 2);
    const r = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'PIN')));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT:0',
      'played:PIN',
      'move:play:PIN:0.hand->0.resolution',
      'effect:0:choose',
      'chosen:0:B1',
      'effect:0:power',
      'mod:B1:power-1000',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'move:eventResolved:PIN:0.resolution->0.waiting',
      'check',
      'playTiming:0:main',
    ]);
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(currentPower(r.state, cat, b1)).toBe(4500);
  });

  it('[PLAY-10] "discard 2 cards" with one card left in hand: that one card is discarded, with no prompt', () => {
    const s0 = mainPhase({ hand: ['Y0', 'DRP'] });
    const y0 = cardIn(s0, 0, 'hand', 'Y0');
    const r = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'DRP')));
    expect(only(trace(r.state, r.events), 'effect', 'move')).toEqual([
      'move:play:DRP:0.hand->0.resolution',
      'effect:0:discard',
      'move:effect:Y0:0.hand->0.waiting',
      'move:eventResolved:DRP:0.resolution->0.waiting',
    ]);
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(r.state.players[0].hand).toEqual([]);
    expect(r.state.players[0].waiting).toEqual([y0, cardIn(r.state, 0, 'waiting', 'DRP')]);
  });

  it('[PLAY-10] "choose 2" with no candidate: nothing is chosen, the power change tied to it is skipped, and the draw that does not depend on it still happens', () => {
    const s0 = mainPhase({ hand: ['PIN'], stage: { 1: 'Y0' } });
    const own = idAt(s0, 0, 1);
    const r = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'PIN')));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT:0',
      'played:PIN',
      'move:play:PIN:0.hand->0.resolution',
      'effect:0:choose',
      'effect:0:power',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'move:eventResolved:PIN:0.resolution->0.waiting',
      'check',
      'playTiming:0:main',
    ]);
    expect(r.events.some((e) => e.kind === 'chosen' || e.kind === 'modifier')).toBe(false);
    expect(r.state.effects).toEqual([]);
    // The player's own character is not a candidate for "your opponent's characters".
    expect(currentPower(r.state, cat, own)).toBe(2000);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['G0']);
  });

  it('[PLAY-10] [PLAY-12] a fixed-number choice in the waiting room (a public zone) is forced even with a condition on card information', () => {
    const s0 = mainPhase({ hand: ['SLV'], waiting: ['Y0', 'YE0', 'B0'] });
    const slv = cardIn(s0, 0, 'hand', 'SLV');
    const y0 = cardIn(s0, 0, 'waiting', 'Y0');
    const ye0 = cardIn(s0, 0, 'waiting', 'YE0');
    const b0 = cardIn(s0, 0, 'waiting', 'B0');

    const r = go(s0, playEvent(0, slv));
    // Only characters qualify; the event card in the waiting room cannot be picked.
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'salvage', card: slv, options: [y0, b0], picked: [], min: 1, max: 1 });
    expect(attempt(r.state, pass(0))).toBe('ILLEGAL_ACTION');
    expect(attempt(r.state, choose(0, ye0))).toBe('ILLEGAL_ACTION');

    const done = go(r.state, choose(0, b0));
    expect(defsIn(done.state, 0, 'hand')).toEqual(['B0']);
    expect(defsIn(done.state, 0, 'waiting')).toEqual(['Y0', 'YE0', 'SLV']);
  });

  it('[PLAY-10] [PLAY-12] choosing 1 blue character on the stage (a public zone) is forced as well: PASS is refused and only blue characters are offered', () => {
    const s0 = mainPhase({ hand: ['BLU'] }, { stage: { 1: 'Y0', 2: 'B0', 3: 'B1' } });
    const blu = cardIn(s0, 0, 'hand', 'BLU');
    const [y0, b0, b1] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];

    const r = go(s0, playEvent(0, blu));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: blu, options: [b0, b1], picked: [], min: 1, max: 1 });
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:B0', 'CHOOSE_CARD:B1']);
    expect(attempt(r.state, pass(0))).toBe('ILLEGAL_ACTION');
    expect(attempt(r.state, choose(0, y0))).toBe('ILLEGAL_ACTION');

    const done = go(r.state, choose(0, b1));
    expect(only(trace(done.state, done.events), 'chosen', 'mod')).toEqual(['chosen:0:B1', 'mod:B1:power-1000']);
    expect([currentPower(done.state, cat, y0), currentPower(done.state, cat, b0), currentPower(done.state, cat, b1)]).toEqual([2000, 2500, 4500]);
  });
});

// =============================================================================
// PLAY-11: "choose up to N" allows any number from 0 to N (CR 8.6.3.1.1)
// =============================================================================

describe('PLAY-11: "up to N" allows any number of targets from zero to N', () => {
  it('[PLAY-11] "choose up to 2": PASS at once chooses nothing; the power change is skipped and the rest of the effect still runs', () => {
    const s0 = mainPhase({ hand: ['UPT'] }, { stage: { 1: 'Y0', 2: 'B1', 3: 'R1' } });
    const upt = cardIn(s0, 0, 'hand', 'UPT');
    const [y0, b1, r1] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];

    const r = go(s0, playEvent(0, upt));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: upt, options: [y0, b1, r1], picked: [], min: 0, max: 2 });
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:B1', 'CHOOSE_CARD:R1', 'CHOOSE_CARD:Y0', 'PASS']);

    const none = go(r.state, pass(0));
    expect(trace(none.state, none.events)).toEqual([
      'action:PASS:0',
      'effect:0:power',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'move:eventResolved:UPT:0.resolution->0.waiting',
      'check',
      'playTiming:0:main',
    ]);
    expect(none.state.effects).toEqual([]);
  });

  it('[PLAY-11] "choose up to 2": one pick then PASS affects only that one; a second pick reaches the maximum and closes the choice', () => {
    const s0 = mainPhase({ hand: ['UPT'] }, { stage: { 1: 'Y0', 2: 'B1', 3: 'R1' } });
    const [y0, b1, r1] = [idAt(s0, 1, 1), idAt(s0, 1, 2), idAt(s0, 1, 3)];
    const r = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'UPT')));

    const one = go(r.state, choose(0, b1));
    expect(pickOf(one.state)).toMatchObject({ options: [y0, r1], picked: [b1], min: 0, max: 2 });
    expect(offers(one.state)).toContain('PASS');
    const stop = go(one.state, pass(0));
    expect(only(trace(stop.state, stop.events), 'chosen', 'mod')).toEqual(['chosen:0:B1', 'mod:B1:power-1000']);
    expect([currentPower(stop.state, cat, y0), currentPower(stop.state, cat, b1), currentPower(stop.state, cat, r1)]).toEqual([2000, 4500, 4500]);

    const two = goAll(r.state, choose(0, y0), choose(0, r1));
    expect(two.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(only(trace(two.state, two.events), 'chosen', 'mod')).toEqual(['chosen:0:Y0,R1', 'mod:Y0:power-1000', 'mod:R1:power-1000']);
    expect(currentPower(two.state, cat, b1)).toBe(5500);
  });

  it('[PLAY-11] "up to 2" with a single candidate still lets the player take none; with no candidate there is nothing to ask', () => {
    const lone = mainPhase({ hand: ['UPT'] }, { stage: { 1: 'Y0' } });
    const upt = cardIn(lone, 0, 'hand', 'UPT');
    const y0 = idAt(lone, 1, 1);
    const r = go(lone, playEvent(0, upt));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', card: upt, options: [y0], picked: [], min: 0, max: 1 });
    const skipped = go(r.state, pass(0));
    expect(currentPower(skipped.state, cat, y0)).toBe(2000);
    expect(skipped.events.some((e) => e.kind === 'chosen' || e.kind === 'modifier')).toBe(false);

    const bare = mainPhase({ hand: ['UPT'] });
    const empty = go(bare, playEvent(0, cardIn(bare, 0, 'hand', 'UPT')));
    expect(empty.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(only(trace(empty.state, empty.events), 'effect', 'chosen', 'mod')).toEqual(['effect:0:choose', 'effect:0:power', 'effect:0:draw']);
  });

  it('[PLAY-11] "return up to 2 cards from your waiting room": zero is allowed, and one pick may be the last', () => {
    const s0 = mainPhase({ hand: ['UPS'], waiting: ['Y0', 'B0', 'R0'] });
    const ups = cardIn(s0, 0, 'hand', 'UPS');
    const [y0, b0, r0] = [cardIn(s0, 0, 'waiting', 'Y0'), cardIn(s0, 0, 'waiting', 'B0'), cardIn(s0, 0, 'waiting', 'R0')];
    const r = go(s0, playEvent(0, ups));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'salvage', card: ups, options: [y0, b0, r0], picked: [], min: 0, max: 2 });

    const none = go(r.state, pass(0));
    expect(none.state.players[0].hand).toEqual([]);
    expect(defsIn(none.state, 0, 'waiting')).toEqual(['Y0', 'B0', 'R0', 'UPS']);

    const one = goAll(r.state, choose(0, r0), pass(0));
    expect(defsIn(one.state, 0, 'hand')).toEqual(['R0']);
    expect(defsIn(one.state, 0, 'waiting')).toEqual(['Y0', 'B0', 'UPS']);
  });

  it('[PLAY-11] "up to" also governs a discard and a take from looked-at cards: with no condition on the cards, zero is still allowed', () => {
    // "Discard up to 2 cards": PASS at once keeps the hand; one discard then PASS is fine too.
    const s0 = mainPhase({ hand: ['Y0', 'B0', 'UPD'] });
    const upd = cardIn(s0, 0, 'hand', 'UPD');
    const [y0, b0] = [cardIn(s0, 0, 'hand', 'Y0'), cardIn(s0, 0, 'hand', 'B0')];
    const r = go(s0, playEvent(0, upd));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'discard', card: upd, options: [y0, b0], picked: [], min: 0, max: 2 });
    const kept = go(r.state, pass(0));
    expect(kept.state.players[0].hand).toEqual([y0, b0]);
    expect(defsIn(kept.state, 0, 'waiting')).toEqual(['UPD']);
    const one = goAll(r.state, choose(0, b0), pass(0));
    expect(one.state.players[0].hand).toEqual([y0]);
    expect(defsIn(one.state, 0, 'waiting')).toEqual(['B0', 'UPD']);

    // "Put up to 1 of the top 2 cards into your hand": taking none sends both to the waiting room.
    const deck = [...PLAIN, 'Y1', 'R1'];
    const l0 = mainPhase({ hand: ['UPL'], deck });
    const upl = cardIn(l0, 0, 'hand', 'UPL');
    const [r1, y1] = [cardIn(l0, 0, 'deck', 'R1'), cardIn(l0, 0, 'deck', 'Y1')];
    const look = go(l0, playEvent(0, upl));
    expect(look.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'lookTake', card: upl, options: [r1, y1], picked: [], min: 0, max: 1 });
    const none = go(look.state, pass(0));
    expect(none.state.players[0].hand).toEqual([]);
    expect(defsIn(none.state, 0, 'waiting')).toEqual(['R1', 'Y1', 'UPL']);
  });
});

// =============================================================================
// PLAY-12: unrevealed cards in a hidden zone chosen by their information may not be found (CR 8.6.3.1.4)
// =============================================================================

describe('PLAY-12: a filtered choice among unrevealed cards in a hidden zone may come up empty', () => {
  it('[PLAY-12] "discard 1 blue card": the player may PASS and discard nothing while holding a blue card; only blue cards can be picked', () => {
    const s0 = mainPhase({ hand: ['Y0', 'B0', 'SFT'] });
    const sft = cardIn(s0, 0, 'hand', 'SFT');
    const y0 = cardIn(s0, 0, 'hand', 'Y0');
    const b0 = cardIn(s0, 0, 'hand', 'B0');

    const r = go(s0, playEvent(0, sft));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'discard', card: sft, options: [b0], picked: [], min: 0, max: 1 });
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:B0', 'PASS']);
    expect(attempt(r.state, choose(0, y0))).toBe('ILLEGAL_ACTION');

    const none = go(r.state, pass(0));
    expect(none.state.players[0].hand).toEqual([y0, b0]);
    expect(defsIn(none.state, 0, 'waiting')).toEqual(['SFT']);
    expect(none.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    const found = go(r.state, choose(0, b0));
    expect(found.state.players[0].hand).toEqual([y0]);
    expect(defsIn(found.state, 0, 'waiting')).toEqual(['B0', 'SFT']);
  });

  it('[PLAY-12] the exception needs a condition on card information: an unfiltered "discard 1 card" is forced; and with no blue card in hand a blue discard still asks, with nothing to pick', () => {
    const s0 = mainPhase({ hand: ['Y0', 'B0', 'DIS'] });
    const dis = cardIn(s0, 0, 'hand', 'DIS');
    const r = go(s0, playEvent(0, dis));
    expect(r.state.pending).toEqual({
      kind: 'pick',
      player: 0,
      purpose: 'discard',
      card: dis,
      options: [cardIn(s0, 0, 'hand', 'Y0'), cardIn(s0, 0, 'hand', 'B0')],
      picked: [],
      min: 1,
      max: 1,
    });
    expect(attempt(r.state, pass(0))).toBe('ILLEGAL_ACTION');

    // The prompt appears whether or not a blue card is there, so its presence tells the opponent nothing about the hand.
    const noBlue = mainPhase({ hand: ['Y0', 'R0', 'SFT'] });
    const sft = cardIn(noBlue, 0, 'hand', 'SFT');
    const asked = go(noBlue, playEvent(0, sft));
    expect(asked.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'discard', card: sft, options: [], picked: [], min: 0, max: 0 });
    expect(offers(asked.state)).toEqual(['PASS']);
    const n = go(asked.state, pass(0));
    expect(n.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(defsIn(n.state, 0, 'hand')).toEqual(['Y0', 'R0']);
    expect(only(trace(asked.state, asked.events), 'move')).toEqual(['move:play:SFT:0.hand->0.resolution']);
    expect(only(trace(n.state, n.events), 'move')).toEqual(['move:eventResolved:SFT:0.resolution->0.waiting']);
  });

  it('[PLAY-12] taking "1 character" from the top 3 cards of the deck may find nothing even when one is there; an unfiltered take is forced', () => {
    // Top of the deck, from the top: YE0 (event), Y0 (character), BX (climax).
    const deck = [...PLAIN, 'BX', 'Y0', 'YE0'];
    const s0 = mainPhase({ hand: ['SCN', 'SCU'], deck });
    const scn = cardIn(s0, 0, 'hand', 'SCN');
    const [ye0, y0, bx] = [cardIn(s0, 0, 'deck', 'YE0'), cardIn(s0, 0, 'deck', 'Y0'), cardIn(s0, 0, 'deck', 'BX')];

    const r = go(s0, playEvent(0, scn));
    expect(only(trace(r.state, r.events), 'look')).toEqual(['look:0:YE0,Y0,BX']);
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'lookTake', card: scn, options: [y0], picked: [], min: 0, max: 1 });
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:Y0', 'PASS']);

    const none = go(r.state, pass(0));
    expect(defsIn(none.state, 0, 'hand')).toEqual(['SCU']);
    expect(defsIn(none.state, 0, 'waiting')).toEqual(['YE0', 'Y0', 'BX', 'SCN']);

    const found = go(r.state, choose(0, y0));
    expect(defsIn(found.state, 0, 'hand')).toEqual(['SCU', 'Y0']);
    expect(defsIn(found.state, 0, 'waiting')).toEqual(['YE0', 'BX', 'SCN']);

    // No condition on the card: one of the three must be taken.
    const scu = cardIn(s0, 0, 'hand', 'SCU');
    const forced = go(s0, playEvent(0, scu));
    expect(forced.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'lookTake', card: scu, options: [ye0, y0, bx], picked: [], min: 1, max: 1 });
    expect(attempt(forced.state, pass(0))).toBe('ILLEGAL_ACTION');
  });

  it('[PLAY-12] [PLAY-14] "your opponent discards 1 blue card": the opponent makes the choice, and may find nothing', () => {
    const s0 = mainPhase({ hand: ['OPD'] }, { hand: ['B0', 'Y0'] });
    const opd = cardIn(s0, 0, 'hand', 'OPD');
    const b0 = cardIn(s0, 1, 'hand', 'B0');
    const y0 = cardIn(s0, 1, 'hand', 'Y0');

    const r = go(s0, playEvent(0, opd));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'discard', card: opd, options: [b0], picked: [], min: 0, max: 1 });
    expect(attempt(r.state, pass(0))).toBe('NOT_YOUR_DECISION');
    expect(legalActions(r.state, cat, 0)).toEqual([]);
    expect(offers(r.state)).toEqual(['CHOOSE_CARD:B0', 'PASS']);

    const none = go(r.state, pass(1));
    expect(none.state.players[1].hand).toEqual([b0, y0]);
    expect(none.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    const found = go(r.state, choose(1, b0));
    expect(found.state.players[1].hand).toEqual([y0]);
    expect(defsIn(found.state, 1, 'waiting')).toEqual(['B0']);
  });
});

// =============================================================================
// PLAY-13: "you may A. If you do, B. If you do not, C." (CR 8.6.4, 8.6.4.1)
// =============================================================================

describe('PLAY-13: "you may" with "if you do" and "if you do not"', () => {
  /** Plays FER (its "when played" ability asks the "you may" question). */
  function playFerryman(clock: string[]): Run & { fer: CardId } {
    const s0 = mainPhase({ hand: ['FER'], clock });
    const fer = cardIn(s0, 0, 'hand', 'FER');
    return { ...go(s0, playChar(0, fer, 1)), fer };
  }

  it('[PLAY-13] accepted and possible: A, then the "if you do" part; the "if you do not" part never runs, and the steps after it still run', () => {
    const r = playFerryman(['Y0']);
    expect(r.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'may', card: r.fer });
    expect(offers(r.state)).toEqual(['ACCEPT', 'PASS']);

    const yes = go(r.state, accept(0));
    expect(trace(yes.state, yes.events)).toEqual([
      'action:ACCEPT:0',
      'optional:0:may:true',
      'effect:0:heal',
      'move:effect:Y0:0.clock->0.waiting',
      'effect:0:power',
      'mod:FER:power+1000',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(currentPower(yes.state, cat, r.fer)).toBe(3000);
    expect(currentSoul(yes.state, cat, r.fer)).toBe(1);
    expect(yes.state.players[0].clock).toEqual([]);
  });

  it('[PLAY-13] declined: A and the "if you do" part are skipped and the "if you do not" part runs', () => {
    const r = playFerryman(['Y0']);
    const no = go(r.state, pass(0));
    expect(trace(no.state, no.events)).toEqual([
      'action:PASS:0',
      'optional:0:may:false',
      'effect:0:soul',
      'mod:FER:soul+1',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(defsIn(no.state, 0, 'clock')).toEqual(['Y0']);
    expect(currentPower(no.state, cat, r.fer)).toBe(2000);
    expect(currentSoul(no.state, cat, r.fer)).toBe(2);
  });

  it('[PLAY-13] A cannot be done (empty clock): the "if you do not" part runs whatever the player answers, and the "if you do" part never does', () => {
    for (const answer of [accept(0), pass(0)]) {
      const r = playFerryman([]);
      // Answer the question if the engine asks it; it cannot change the outcome.
      const end = r.state.pending?.kind === 'optional' ? go(r.state, answer) : { state: r.state, events: [] };
      const t = trace(end.state, [...r.events, ...end.events]);
      expect(only(from(t, 'ability:0:FER#0:automatic'), 'effect', 'mod', 'move')).toEqual([
        'effect:0:may',
        'effect:0:soul',
        'mod:FER:soul+1',
        'effect:0:draw',
        'move:draw:G0:0.deck->0.hand',
      ]);
      expect(currentPower(end.state, cat, r.fer)).toBe(2000);
      expect(currentSoul(end.state, cat, r.fer)).toBe(2);
      expect(end.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    }
  });

  it('[PLAY-13] A that can only be done in part was not done: "you may discard 2" with one card in hand discards nothing and runs the "if you do not" part', () => {
    const short = mainPhase({ hand: ['Y0', 'TWO'] });
    const y0 = cardIn(short, 0, 'hand', 'Y0');
    const r = go(short, playEvent(0, cardIn(short, 0, 'hand', 'TWO')));
    const end = r.state.pending?.kind === 'optional' ? go(r.state, accept(0)) : { state: r.state, events: [] };
    expect(only(trace(end.state, [...r.events, ...end.events]), 'effect', 'move:effect', 'move:draw')).toEqual([
      'effect:0:may',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
    ]);
    expect(end.state.players[0].hand).toEqual([y0, cardIn(end.state, 0, 'hand', 'G0')]);
    expect(end.state.players[0].stock).toEqual([]);

    // With two cards it can be done: both go, then the "if you do" part, and no draw.
    const enough = mainPhase({ hand: ['Y0', 'B0', 'TWO'] });
    const done = goAll(enough, playEvent(0, cardIn(enough, 0, 'hand', 'TWO')), accept(0));
    expect(only(trace(done.state, done.events), 'optional', 'effect', 'move:effect', 'move:draw')).toEqual([
      'effect:0:may',
      'optional:0:may:true',
      'effect:0:discard',
      'move:effect:Y0:0.hand->0.waiting',
      'move:effect:B0:0.hand->0.waiting',
      'effect:0:stockFromDeck',
      'move:effect:G0:0.deck->0.stock',
      'move:effect:G0:0.deck->0.stock',
    ]);
    expect(done.state.players[0].hand).toEqual([]);
    expect(done.state.players[0].stock).toHaveLength(2);
  });

  it('[PLAY-13] the "if you do" part follows only from A actually done: after saying yes to a blue discard, every way on either discards a blue card and gets B, or gets C', () => {
    const s0 = mainPhase({ hand: ['Y0', 'B0', 'B1', 'BLD'] });
    const yes = goAll(s0, playEvent(0, cardIn(s0, 0, 'hand', 'BLD')), accept(0));
    const prompt = pickOf(yes.state);
    expect(prompt).toMatchObject({ player: 0, purpose: 'discard', options: [cardIn(s0, 0, 'hand', 'B0'), cardIn(s0, 0, 'hand', 'B1')] });

    const ways = legalActions(yes.state, cat);
    expect(ways.length).toBeGreaterThan(0);
    for (const way of ways) {
      let run = go(yes.state, way);
      // Finish the discard if more answers are needed (a pass ends it).
      while (run.state.pending?.kind === 'pick') {
        const next = go(run.state, pass(0));
        run = { state: next.state, events: [...run.events, ...next.events] };
      }
      const discarded = run.state.players[0].waiting.filter((c) => run.state.cards[c]?.def === 'B0' || run.state.cards[c]?.def === 'B1');
      const t = only(trace(run.state, run.events), 'effect');
      if (discarded.length === 1) {
        expect(t).toEqual(['effect:0:stockFromDeck']);
        expect(run.state.players[0].stock).toHaveLength(2);
      } else {
        expect(discarded).toEqual([]);
        expect(t).toEqual(['effect:0:draw']);
        expect(run.state.players[0].stock).toEqual([]);
      }
    }
    // Picking B1 discards it and then gives B, not C.
    const b1 = go(yes.state, choose(0, cardIn(s0, 0, 'hand', 'B1')));
    expect(defsIn(b1.state, 0, 'hand')).toEqual(['Y0', 'B0']);
    expect(defsIn(b1.state, 0, 'waiting')).toEqual(['B1', 'BLD']);
    expect(b1.state.players[0].stock).toHaveLength(2);
  });

  it('[PLAY-13] "you may discard 1 blue card" holding only cards of other colors: A cannot be done, so a yes still leads to the "if you do not" part and nothing is discarded', () => {
    const s0 = mainPhase({ hand: ['Y0', 'R0', 'BLD'] });
    const [y0, r0] = [cardIn(s0, 0, 'hand', 'Y0'), cardIn(s0, 0, 'hand', 'R0')];
    const r = go(s0, playEvent(0, cardIn(s0, 0, 'hand', 'BLD')));
    const end = r.state.pending?.kind === 'optional' ? go(r.state, accept(0)) : { state: r.state, events: [] };
    expect(only(trace(end.state, [...r.events, ...end.events]), 'effect', 'move:effect', 'move:draw')).toEqual([
      'effect:0:may',
      'effect:0:draw',
      'move:draw:G0:0.deck->0.hand',
    ]);
    expect(end.state.players[0].hand).toEqual([y0, r0, cardIn(end.state, 0, 'hand', 'G0')]);
    expect(end.state.players[0].stock).toEqual([]);
    expect(defsIn(end.state, 0, 'waiting')).toEqual(['BLD']);
  });

  it('[PLAY-13] "you may choose": with no character to choose the "if you do not" part runs; with one, the "if you do" part hits the chosen card', () => {
    const empty = mainPhase({ hand: ['MCH'] });
    const r = go(empty, playEvent(0, cardIn(empty, 0, 'hand', 'MCH')));
    const end = r.state.pending?.kind === 'optional' ? go(r.state, accept(0)) : { state: r.state, events: [] };
    const t = trace(end.state, [...r.events, ...end.events]);
    expect(only(t, 'effect', 'chosen', 'mod', 'move:draw')).toEqual(['effect:0:may', 'effect:0:draw', 'move:draw:G0:0.deck->0.hand']);

    const one = mainPhase({ hand: ['MCH'] }, { stage: { 2: 'B1' } });
    const b1 = idAt(one, 1, 2);
    const hit = goAll(one, playEvent(0, cardIn(one, 0, 'hand', 'MCH')), accept(0));
    expect(only(trace(hit.state, hit.events), 'optional', 'effect', 'chosen', 'mod', 'move:draw')).toEqual([
      'effect:0:may',
      'optional:0:may:true',
      'effect:0:choose',
      'chosen:0:B1',
      'effect:0:power',
      'mod:B1:power-2000',
    ]);
    expect(currentPower(hit.state, cat, b1)).toBe(3500);
    expect(hit.state.players[0].hand).toEqual([]);
  });

  it('[PLAY-13] card text writes the two follow-up clauses in the short form "If you do" / "If you do not", each followed by its own part', () => {
    // The rules' own short form is past tense; printed cards use the present tense. Either way the
    // action is not repeated, and the "if you do" clause carries B while "if you do not" carries C.
    const [text] = cardText(cat.FER as CardDef);
    // Inside a sentence the parts are separated by semicolons, so the draw after them reads as its own step.
    expect(text).toMatch(/you may [^.;]+; if you do, [^.;]+; if you do not, [^.;]+\./i);
    expect(text).toContain(
      'you may put the top card of your clock into your waiting room; if you do, this card gets +1000 power until end of turn; if you do not, this card gets +1 soul until end of turn. Draw 1 card.',
    );
    expect(text?.toLowerCase()).not.toContain('if you did');
  });
});

// =============================================================================
// PLAY-14: unless the text names someone, the master performs (CR 8.6.5)
// =============================================================================

describe('PLAY-14: the master of the card or ability carries out what the text does not assign to anyone', () => {
  it('[PLAY-14] a "when reversed" ability of the non-turn player\'s character: its master draws, chooses and answers "you may"; the parts naming the opponent are done by the turn player', () => {
    // P0 (turn player) attacks WRD with R0 (3000 vs 2000). The damage card G0 lands in P1's clock, so a heal is possible.
    // P0's Y0 can still attack afterwards, so the game stops at P0's next declaration.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'R0' }, hand: ['Y0'], deck: [...PLAIN, 'R1', 'G0'] }, { stage: { 1: 'B0', 2: 'WRD' }, deck: [...PLAIN, 'B1', 'G0'] });
    const wrd = idAt(s0, 1, 2);
    const b0 = idAt(s0, 1, 1);
    const battle = goAll(s0, attack(0, 2), pass(1));
    const t = trace(battle.state, battle.events);
    expect(only(from(t, 'step:battle'), 'battle', 'ability', 'effect', 'move:draw')).toEqual([
      'battle:WRD',
      'ability:1:WRD#0:automatic',
      'effect:1:draw',
      'move:draw:B1:1.deck->1.hand',
      'effect:1:choose',
    ]);
    // The choice belongs to P1, the master, though it is P0's turn.
    expect(battle.state.active).toBe(0);
    expect(battle.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'target', card: wrd, options: [b0, wrd], picked: [], min: 1, max: 1 });
    expect(attempt(battle.state, choose(0, b0))).toBe('NOT_YOUR_DECISION');

    const chosen = go(battle.state, choose(1, b0));
    expect(only(trace(chosen.state, chosen.events), 'chosen', 'mod', 'effect')).toEqual(['chosen:1:B0', 'effect:1:power', 'mod:B0:power+1000', 'effect:1:may']);
    expect(chosen.state.pending).toEqual({ kind: 'optional', player: 1, purpose: 'may', card: wrd });

    const healed = go(chosen.state, accept(1));
    expect(only(trace(healed.state, healed.events), 'optional', 'effect', 'move')).toEqual([
      'optional:1:may:true',
      'effect:1:heal',
      'move:effect:G0:1.clock->1.waiting',
      'effect:1:draw',
      'move:draw:R1:0.deck->0.hand',
      'effect:1:discard',
    ]);
    // "Your opponent" is P0: P0 drew, and P0 picks the card to discard.
    expect(healed.state.pending).toEqual({
      kind: 'pick',
      player: 0,
      purpose: 'discard',
      card: wrd,
      options: [cardIn(healed.state, 0, 'hand', 'Y0'), cardIn(healed.state, 0, 'hand', 'R1')],
      picked: [],
      min: 1,
      max: 1,
    });
    const done = go(healed.state, choose(0, cardIn(healed.state, 0, 'hand', 'R1')));
    expect(done.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(done.state, 0, 'hand')).toEqual(['Y0']);
    expect(defsIn(done.state, 0, 'waiting')).toEqual(['R1']);
    expect(defsIn(done.state, 1, 'hand')).toEqual(['B1']);
    expect(currentPower(done.state, cat, b0)).toBe(3500);
  });

  it('[PLAY-14] a counter event played by the non-turn player: that player, its master, makes its choice and draws', () => {
    // P0's Y0 can still attack afterwards, so the game stops at P0's next declaration.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'R0' } }, { stage: { 1: 'B0', 2: 'G0' }, hand: ['RCE'], deck: [...PLAIN, 'B1'] });
    const rce = cardIn(s0, 1, 'hand', 'RCE');
    const [b0, g0] = [idAt(s0, 1, 1), idAt(s0, 1, 2)];
    const counter = go(s0, attack(0, 2));
    expect(counter.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    const r = go(counter.state, playEvent(1, rce));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'target', card: rce, options: [b0, g0], picked: [], min: 1, max: 1 });
    expect(attempt(r.state, choose(0, g0))).toBe('NOT_YOUR_DECISION');

    const done = go(r.state, choose(1, g0));
    expect(only(trace(done.state, done.events), 'chosen', 'mod:G0', 'effect', 'move:draw').slice(0, 5)).toEqual([
      'chosen:1:G0',
      'effect:1:power',
      'mod:G0:power+2000',
      'effect:1:draw',
      'move:draw:B1:1.deck->1.hand',
    ]);
    expect(done.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(done.state, 1, 'hand')).toEqual(['B1']);
    expect(done.state.players[0].hand).toEqual([]);
  });

  it("[PLAY-14] a counter event of the non-turn player returns a card from its master's waiting room and fills its master's stock, leaving the turn player's zones alone", () => {
    // Both waiting rooms hold cards, so returning from the wrong one would show.
    const s0 = attackPhase(
      { stage: { 1: 'Y0', 2: 'R0' }, waiting: ['Y1'], deck: [...PLAIN, 'R1'] },
      { stage: { 1: 'B0', 2: 'G0' }, hand: ['RCS'], waiting: ['B1', 'R0'], deck: [...PLAIN, 'B0'] },
    );
    const rcs = cardIn(s0, 1, 'hand', 'RCS');
    const [b1, r0] = [cardIn(s0, 1, 'waiting', 'B1'), cardIn(s0, 1, 'waiting', 'R0')];
    const counter = go(s0, attack(0, 2));
    expect(counter.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    // P0's stock holds the trigger card (R1) by now; P1's stock is empty.
    const p0Stock = [...counter.state.players[0].stock];
    expect(defsIn(counter.state, 0, 'stock')).toEqual(['R1']);
    expect(counter.state.players[1].stock).toEqual([]);

    const r = go(counter.state, playEvent(1, rcs));
    expect(r.state.pending).toEqual({ kind: 'pick', player: 1, purpose: 'salvage', card: rcs, options: [b1, r0], picked: [], min: 1, max: 1 });
    expect(attempt(r.state, choose(0, b1))).toBe('NOT_YOUR_DECISION');

    const done = go(r.state, choose(1, b1));
    expect(only(trace(done.state, done.events), 'effect', 'move:effect')).toEqual([
      'move:effect:B1:1.waiting->1.hand',
      'effect:1:stockFromDeck',
      'move:effect:B0:1.deck->1.stock',
    ]);
    expect(done.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(done.state, 1, 'hand')).toEqual(['B1']);
    expect(defsIn(done.state, 1, 'stock')).toEqual(['B0']);
    expect(defsIn(done.state, 1, 'waiting')).toEqual(['R0', 'RCS']);
    expect(done.state.players[0].stock).toEqual(p0Stock);
    expect(defsIn(done.state, 0, 'waiting')).toEqual(['Y1']);
    expect(done.state.players[0].hand).toEqual([]);
  });
});
