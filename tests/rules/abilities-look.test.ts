// Rule tests for M3: looking at cards from the top of the deck (CR 4.8), the
// "up to N" stop option for deck actions (CR 3.2.3.1), a deck holding fewer
// cards than an action names while cards stay in it (CR 3.2.3.3), and when a
// look ends (CR 8.6.6). Looks come from the `lookTop` effect step; "draw up to"
// is the other "up to N" deck action in the v1 language.
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, legalActions, projectEvents, projectView, validateCatalog } from '../../src/engine';
import type { Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Step } from '../../src/engine';
import { cardIn, defsIn, makeState } from '../../src/engine/testkit';
import type { ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

/** A level 0, cost 0 yellow event with this effect. */
const event = (id: string, name: string, effect: Step[]): CardDef => ({ id, name, kind: 'event', color: 'yellow', level: 0, cost: 0, effect });

const mayDraw: Step = { do: 'may', steps: [{ do: 'draw', count: 1 }] };

const extra: CardDef[] = [
  // Look at the top 3 cards of your deck, and put them back on top in any order.
  event('LT3', 'Glass Survey', [{ do: 'lookTop', count: 3, rest: 'top' }]),
  // Same as LT3 but for 5 cards: look at 5 from the top, then return them to the top in an order of your choice.
  event('LT5', 'Wide Survey', [{ do: 'lookTop', count: 5, rest: 'top' }]),
  // Look at up to 3 cards from the top of your deck, and put them back on top in any order.
  event('LU3', 'Careful Survey', [{ do: 'lookTop', count: 3, upTo: true, rest: 'top' }]),
  // Look at up to 5 cards from the top of your deck, and put them back on top in any order.
  event('LU5', 'Patient Survey', [{ do: 'lookTop', count: 5, upTo: true, rest: 'top' }]),
  // Look at up to 3 cards from the top, choose up to 1 of them for your stock, and put the rest on the bottom in any order.
  event('LUS', 'Ledger Survey', [{ do: 'lookTop', count: 3, upTo: true, take: { count: 1, upTo: true, to: 'stock' }, rest: 'bottom' }]),
  // Look at the top 3 cards, choose 1 of them for your stock, and put the rest on top in any order.
  event('LTS', 'Vault Survey', [{ do: 'lookTop', count: 3, take: { count: 1, to: 'stock' }, rest: 'top' }]),
  // Look at the top 2 cards and put them back on top in any order. Then you may draw a card.
  event('LTM', 'Survey and Reach', [{ do: 'lookTop', count: 2, rest: 'top' }, mayDraw]),
  // Look at the top 2 cards and put them into your waiting room. Then you may draw a card.
  event('LWM', 'Survey and Sweep', [{ do: 'lookTop', count: 2, rest: 'waiting' }, mayDraw]),
  // Look at the top card and put it on the bottom of your deck. Then you may draw a card.
  event('LBM', 'Survey and Sink', [{ do: 'lookTop', count: 1, rest: 'bottom' }, mayDraw]),
  // Look at the top card and put it back on top. Then you may draw a card.
  event('L1M', 'Survey and Hold', [{ do: 'lookTop', count: 1, rest: 'top' }, mayDraw]),
  // Look at up to 3 cards from the top and put them back on top in any order. Then you may draw a card.
  event('LUM', 'Survey and Pause', [{ do: 'lookTop', count: 3, upTo: true, rest: 'top' }, mayDraw]),
  // Look at the top 2 cards, put up to 2 of them into your waiting room, and put the rest back on top in any order.
  event('LTW', 'Survey and Shed', [{ do: 'lookTop', count: 2, take: { count: 2, upTo: true, to: 'waiting' }, rest: 'top' }]),
  // Draw up to 2 cards.
  event('DU2', 'Measured Supply', [{ do: 'draw', count: 2, upTo: true }]),
  // Draw 2 cards.
  event('DR2', 'Full Supply', [{ do: 'draw', count: 2 }]),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Five different plain characters, bottom -> top: the top card is B1, then Y1, then R0, then B0, then G0 at the bottom. */
const DECK5 = ['G0', 'B0', 'R0', 'Y1', 'B1'];

/** Main Phase of player 0's turn, with these zones for player 0. */
function mainPhase(p0: ZoneSpec, p1: ZoneSpec = {}): GameState {
  return makeState(cat, { start: 'main', players: [{ deck: DECK5, ...p0 }, { deck: ['G0', 'G0', 'G0'], ...p1 }] });
}

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });

interface Run {
  state: GameState;
  /** Every event since the run started, in order. */
  events: GameEvent[];
}

/** Applies actions in order, keeping every event; throws with the engine's reason if one is refused. */
function play(s: GameState, ...actions: Action[]): Run {
  let state = s;
  const events: GameEvent[] = [];
  for (const action of actions) {
    const r = applyAction(state, cat, action);
    if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/** Plays the event in player 0's hand. */
function playEvent(s: GameState, def: string): Run {
  return play(s, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', def) });
}

/** Continues a run with more actions. */
function then(r: Run, ...actions: Action[]): Run {
  const next = play(r.state, ...actions);
  return { state: next.state, events: [...r.events, ...next.events] };
}

const defOf = (s: GameState, id: CardId): string => s.cards[id]?.def ?? id;

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.zone}->${e.to.zone}`];
    if (e.kind === 'look') return [`look:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'lookEnd') return ['lookEnd'];
    if (e.kind === 'deckArranged') return [`arranged:top${e.top}:bottom${e.bottom}`];
    if (e.kind === 'optional') return [`optional:${e.purpose}:${e.accepted ? 'yes' : 'no'}`];
    if (e.kind === 'effect') return [`effect:${e.op}`];
    if (e.kind === 'refresh') return ['refresh'];
    if (e.kind === 'shuffle') return ['shuffle'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    return [];
  });
}

/** Definition ids of the cards in the 'look' events, one entry per event. */
const looks = (s: GameState, events: readonly GameEvent[]): string[][] =>
  events.flatMap((e) => (e.kind === 'look' ? [e.cards.map((c) => defOf(s, c))] : []));

/** The deck as (id, epoch) pairs, bottom -> top: equal only if no card moved or became a new object. */
const deckObjects = (s: GameState, player: PlayerId): string[] => s.players[player].deck.map((c) => `${c}@${s.cards[c]?.epoch ?? '?'}`);

/** What the looker's view lists as looked at, by definition id (top first). */
function lookedDefs(s: GameState, viewer: PlayerId): string[] | null {
  const look = projectView(s, viewer).look;
  return look?.cards ? look.cards.map((c) => c.def) : null;
}

const pendingKind = (s: GameState): string => {
  const p = s.pending;
  if (!p) return 'none';
  if (p.kind === 'pick') return `pick:${p.player}:${p.purpose}`;
  if (p.kind === 'optional') return `optional:${p.player}:${p.purpose}`;
  if (p.kind === 'play') return `play:${p.player}:${p.window}`;
  return p.kind;
};

// --- CR 4.8.1: looking at the top of the deck ------------------------------------

describe('looking at cards from the top of the deck (CR 4.8)', () => {
  it('[CONC-17] "look at the top 3": the player sees exactly the top 3 cards, top first, while all of them stay in the deck as the same objects', () => {
    // Sanity: the synthetic cards of this file are valid card data.
    expect(validateCatalog(cat)).toEqual([]);
    const s0 = mainPhase({ hand: ['LT3'] });
    const before = deckObjects(s0, 0);
    const r = playEvent(s0, 'LT3');

    // The look is under way: the player is ordering the 3 cards to go back on top.
    expect(pendingKind(r.state)).toBe('pick:0:orderTop');
    expect(looks(r.state, r.events)).toEqual([['B1', 'Y1', 'R0']]);
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1', 'R0']);
    // Nothing left the deck: same 5 cards, same order, same object identities; no card moved out of it.
    expect(deckObjects(r.state, 0)).toEqual(before);
    expect(r.state.players[0].hand).toEqual([]);
    expect(r.events.filter((e) => e.kind === 'move' && e.from.zone === 'deck')).toEqual([]);
    expect(defsIn(r.state, 0, 'resolution')).toEqual(['LT3']);
    // The deck below the looked-at cards (B0, G0) is not looked at.
    expect(projectView(r.state, 0).look?.count).toBe(3);
  });

  it('[CONC-17] looking is private: the opponent learns how many cards are being looked at, never which ones, nor the choices made about them', () => {
    const s0 = mainPhase({ hand: ['LT3'] });
    const r = playEvent(s0, 'LT3');
    const top = r.state.players[0].deck.slice(-3).reverse();

    // The looker's view lists the cards; the opponent's view gives only the count.
    expect(projectView(r.state, 0).look).toEqual({ player: 0, count: 3, cards: top.map((id) => ({ id, def: defOf(r.state, id) })) });
    expect(projectView(r.state, 1).look).toEqual({ player: 0, count: 3, cards: null });
    // The deck stays a hidden zone for both players: a count only.
    expect(projectView(r.state, 1).players[0].counts.deck).toBe(5);
    // The 'look' event is named for the looker and blanked for the opponent, card count kept.
    const lookFor = (viewer: PlayerId) => projectEvents(r.events, viewer).filter((e) => e.kind === 'look');
    expect(lookFor(0).map((e) => (e.kind === 'look' ? e.cards : []))).toEqual([top]);
    expect(lookFor(1).map((e) => (e.kind === 'look' ? e.cards : []))).toEqual([['?', '?', '?']]);
    // The ordering prompt (whose options are the looked-at cards) is hidden from the opponent.
    expect(projectView(r.state, 1).pending).toEqual({ kind: 'pick', player: 0, redacted: true });
    const oppView = JSON.stringify(projectView(r.state, 1));
    for (const id of top) expect(oppView).not.toContain(`"${id}"`);

    // The player's answers name looked-at cards; the opponent sees that answers were given, not which cards.
    const done = then(r, choose(0, top[2] ?? ''), choose(0, top[0] ?? ''));
    const answersFor = (viewer: PlayerId) =>
      projectEvents(done.events, viewer).flatMap((e) => (e.kind === 'action' && e.action.type === 'CHOOSE_CARD' ? [e.action.card] : []));
    expect(answersFor(0)).toEqual([top[2], top[0]]);
    expect(answersFor(1)).toEqual(['?', '?']);
  });

  it('[CONC-17] "look at up to 3": each card the player chooses to look at is shown to them and stays in the deck, untouched', () => {
    const s0 = mainPhase({ hand: ['LU3'] });
    const before = deckObjects(s0, 0);
    const r = then(playEvent(s0, 'LU3'), accept(0), accept(0));

    expect(pendingKind(r.state)).toBe('optional:0:lookMore');
    expect(looks(r.state, r.events)).toEqual([['B1'], ['Y1']]);
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1']);
    expect(projectView(r.state, 1).look).toEqual({ player: 0, count: 2, cards: null });
    expect(deckObjects(r.state, 0)).toEqual(before);
    expect(r.events.filter((e) => e.kind === 'move' && e.from.zone === 'deck')).toEqual([]);
  });

  it('[CONC-17] put back unchanged, the looked-at cards are exactly where they were: same order, same objects, and only the event card ever moved', () => {
    const s0 = mainPhase({ hand: ['LT3'] });
    const before = deckObjects(s0, 0);
    let r = playEvent(s0, 'LT3');
    const [b1, y1] = r.state.players[0].deck.slice(-2).reverse() as [CardId, CardId];
    // The first card picked goes highest: B1 then Y1 (R0 last) is the original order.
    r = then(r, choose(0, b1), choose(0, y1));

    expect(deckObjects(r.state, 0)).toEqual(before);
    expect(defsIn(r.state, 0, 'deck')).toEqual(DECK5);
    expect(trace(r.state, r.events).filter((t) => t.startsWith('move:'))).toEqual(['move:play:LT3:hand->resolution', 'move:eventResolved:LT3:resolution->waiting']);
    expect(pendingKind(r.state)).toBe('play:0:main');
  });
});

// --- CR 3.2.3.1: "up to N" may stop before each card ------------------------------------

describe('"up to N" deck actions: the player may stop before each card (CR 3.2.3.1)', () => {
  it('[ZONE-09] "look at up to 3": the stop-or-continue question comes before the first card, and stopping there looks at nothing', () => {
    const s0 = mainPhase({ hand: ['LU3'] });
    const r = playEvent(s0, 'LU3');

    // Asked before any card is looked at.
    expect(pendingKind(r.state)).toBe('optional:0:lookMore');
    expect(looks(r.state, r.events)).toEqual([]);
    expect(projectView(r.state, 0).look?.count).toBe(0);
    expect(legalActions(r.state, cat)).toEqual(expect.arrayContaining([accept(0), pass(0)]));
    expect(legalActions(r.state, cat)).toHaveLength(2);

    // CR 3.2.3.1.1: ending the action before the first card handles no card at all.
    const done = then(r, pass(0));
    expect(looks(done.state, done.events)).toEqual([]);
    expect(done.events.filter((e) => e.kind === 'optional').map((e) => (e.kind === 'optional' ? `${e.purpose}:${e.accepted}` : ''))).toEqual(['lookMore:false']);
    expect(defsIn(done.state, 0, 'deck')).toEqual(DECK5);
    expect(defsIn(done.state, 0, 'waiting')).toEqual(['LU3']);
    expect(done.state.resolving).toBeNull();
    expect(pendingKind(done.state)).toBe('play:0:main');
  });

  it('[ZONE-09] the question is asked again before each next card: one card per yes, and a no after the first card ends the action with that card alone looked at', () => {
    const s0 = mainPhase({ hand: ['LU3'] });
    const r = then(playEvent(s0, 'LU3'), accept(0));

    expect(looks(r.state, r.events)).toEqual([['B1']]);
    expect(pendingKind(r.state)).toBe('optional:0:lookMore');

    const done = then(r, pass(0));
    expect(trace(done.state, done.events)).toEqual([
      'action:PLAY_EVENT',
      'move:play:LU3:hand->resolution',
      'effect:lookTop',
      'action:ACCEPT',
      'optional:lookMore:yes',
      'look:B1',
      'action:PASS',
      'optional:lookMore:no',
      // One card back on top: no order to choose.
      'lookEnd',
      'move:eventResolved:LU3:resolution->waiting',
      'playTiming:0:main',
    ]);
    // Y1, the next card, was never looked at.
    expect(looks(done.state, done.events).flat()).not.toContain('Y1');
    expect(defsIn(done.state, 0, 'deck')).toEqual(DECK5);
  });

  it('[ZONE-09] a "yes" each time looks at the cards one at a time, top down; after the Nth card no further question is asked', () => {
    const s0 = mainPhase({ hand: ['LU3'] });
    const r = then(playEvent(s0, 'LU3'), accept(0), accept(0), accept(0));

    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT',
      'move:play:LU3:hand->resolution',
      'effect:lookTop',
      'action:ACCEPT',
      'optional:lookMore:yes',
      'look:B1',
      'action:ACCEPT',
      'optional:lookMore:yes',
      'look:Y1',
      'action:ACCEPT',
      'optional:lookMore:yes',
      'look:R0',
    ]);
    // Three cards reached: the action moves on to putting them back, with no fourth question.
    expect(pendingKind(r.state)).toBe('pick:0:orderTop');
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1', 'R0']);
  });

  it('[ZONE-09] stopping early leaves the unlooked cards out of the action: only looked-at cards can be taken', () => {
    const s0 = mainPhase({ hand: ['LUS'] });
    const r = then(playEvent(s0, 'LUS'), accept(0), accept(0), pass(0));
    const deck = r.state.players[0].deck;

    expect(r.state.pending).toEqual({
      kind: 'pick',
      player: 0,
      purpose: 'lookTake',
      card: cardIn(r.state, 0, 'resolution', 'LUS'),
      options: [deck[4], deck[3]],
      picked: [],
      min: 0,
      max: 1,
    });
    expect((r.state.pending?.kind === 'pick' ? r.state.pending.options : []).map((c) => defOf(r.state, c))).toEqual(['B1', 'Y1']);
  });

  it('[ZONE-09] a fixed "look at the top 3" is not an "up to" action: there is no stop question, and all 3 are looked at, top first, with no decision between them', () => {
    const s0 = mainPhase({ hand: ['LT3'] });
    const r = playEvent(s0, 'LT3');

    expect(r.events.filter((e) => e.kind === 'optional')).toEqual([]);
    // CR 3.2.3 handles deck cards one by one from the top. Looking moves no card, so nothing can
    // happen between them, and the engine reports the 3 cards in one 'look' event, in that order.
    expect(looks(r.state, r.events)).toEqual([['B1', 'Y1', 'R0']]);
    expect(pendingKind(r.state)).toBe('pick:0:orderTop');
  });

  it('[ZONE-09] "draw up to 2": asked before each draw; stopping before the first draws nothing', () => {
    const s0 = mainPhase({ hand: ['DU2'] });
    const r = playEvent(s0, 'DU2');

    expect(pendingKind(r.state)).toBe('optional:0:drawMore');
    expect(r.events.filter((e) => e.kind === 'move' && e.reason === 'draw')).toEqual([]);

    const done = then(r, pass(0));
    expect(done.events.filter((e) => e.kind === 'move' && e.reason === 'draw')).toEqual([]);
    expect(defsIn(done.state, 0, 'hand')).toEqual([]);
    expect(defsIn(done.state, 0, 'deck')).toEqual(DECK5);
    expect(pendingKind(done.state)).toBe('play:0:main');
  });

  it('[ZONE-09] "draw up to 2": a yes draws one card and asks again; a no then ends it with one card drawn; two yeses draw two with no third question', () => {
    const s0 = mainPhase({ hand: ['DU2'] });
    const once = then(playEvent(s0, 'DU2'), accept(0));
    expect(defsIn(once.state, 0, 'hand')).toEqual(['B1']);
    expect(pendingKind(once.state)).toBe('optional:0:drawMore');

    const one = then(once, pass(0));
    expect(defsIn(one.state, 0, 'hand')).toEqual(['B1']);
    expect(defsIn(one.state, 0, 'deck')).toEqual(['G0', 'B0', 'R0', 'Y1']);
    expect(pendingKind(one.state)).toBe('play:0:main');

    const two = then(once, accept(0));
    expect(trace(two.state, two.events).filter((t) => t.startsWith('optional') || t.startsWith('move:draw'))).toEqual([
      'optional:drawMore:yes',
      'move:draw:B1:deck->hand',
      'optional:drawMore:yes',
      'move:draw:Y1:deck->hand',
    ]);
    expect(defsIn(two.state, 0, 'hand')).toEqual(['B1', 'Y1']);
    expect(pendingKind(two.state)).toBe('play:0:main');
  });
});

// --- CR 3.2.3.3: fewer cards than asked, with cards staying in the deck -----------------

describe('fewer deck cards than the action names, when cards would stay in the deck (CR 3.2.3.3)', () => {
  it('[ZONE-11] "look at the top 5" with 3 cards in the deck: those 3 are looked at and the look ends there; no refresh, nothing taken from the waiting room', () => {
    const s0 = mainPhase({ deck: ['G0', 'B0', 'R0'], hand: ['LT5'], waiting: ['Y1', 'Y1'] });
    const r = playEvent(s0, 'LT5');

    expect(looks(r.state, r.events)).toEqual([['R0', 'B0', 'G0']]);
    expect(r.state.pending).toMatchObject({ kind: 'pick', player: 0, purpose: 'orderTop', min: 2, max: 2 });
    expect((r.state.pending?.kind === 'pick' ? r.state.pending.options : []).map((c) => defOf(r.state, c))).toEqual(['R0', 'B0', 'G0']);

    const [r0, b0] = r.state.players[0].deck.slice(-2).reverse() as [CardId, CardId];
    const done = then(r, choose(0, r0), choose(0, b0));
    expect(done.events.filter((e) => e.kind === 'refresh' || e.kind === 'shuffle')).toEqual([]);
    expect(done.events.filter((e) => e.kind === 'move' && (e.reason === 'refresh' || e.reason === 'refreshClock'))).toEqual([]);
    expect(defsIn(done.state, 0, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(defsIn(done.state, 0, 'waiting')).toEqual(['Y1', 'Y1', 'LT5']);
    expect(defsIn(done.state, 0, 'clock')).toEqual([]);
    expect(pendingKind(done.state)).toBe('play:0:main');
  });

  it('[ZONE-11] "look at up to 5" with 3 cards in the deck: after the third card there is no fourth question and no refresh', () => {
    const s0 = mainPhase({ deck: ['G0', 'B0', 'R0'], hand: ['LU5'], waiting: ['Y1', 'Y1'] });
    const r = then(playEvent(s0, 'LU5'), accept(0), accept(0), accept(0));

    expect(looks(r.state, r.events)).toEqual([['R0'], ['B0'], ['G0']]);
    expect(r.events.filter((e) => e.kind === 'optional')).toHaveLength(3);
    expect(pendingKind(r.state)).toBe('pick:0:orderTop');
    expect(r.events.filter((e) => e.kind === 'refresh')).toEqual([]);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['G0', 'B0', 'R0']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['Y1', 'Y1']);
  });

  it('[ZONE-11] boundary: a single card in the deck and "look at the top 3": that one card is looked at, left on top, and the action ends; the deck is never empty', () => {
    const s0 = mainPhase({ deck: ['R0'], hand: ['LT3'], waiting: ['Y1'] });
    const r = playEvent(s0, 'LT3');

    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT',
      'move:play:LT3:hand->resolution',
      'effect:lookTop',
      'look:R0',
      'lookEnd',
      'move:eventResolved:LT3:resolution->waiting',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['R0']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['Y1', 'LT3']);
  });

  it('[ZONE-11] the early end applies only when cards would remain: "draw 2" from a 1-card deck empties it, so it refreshes and still draws the second card', () => {
    const s0 = mainPhase({ deck: ['R0'], hand: ['DR2'], waiting: ['Y1', 'Y1', 'Y1'] });
    const r = playEvent(s0, 'DR2');

    expect(trace(r.state, r.events).filter((t) => t.startsWith('move:draw') || t === 'refresh')).toEqual([
      'move:draw:R0:deck->hand',
      'refresh',
      'move:draw:Y1:deck->hand',
    ]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['R0', 'Y1']);
    // The refresh happened (its point went to the clock); one refreshed card is left in the deck.
    expect(defsIn(r.state, 0, 'clock')).toEqual(['Y1']);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['Y1']);
  });
});

// --- CR 8.6.6: when a look ends ---------------------------------------------------

describe('a look ends with its effect, or sooner for a card that moves or is put back (CR 8.6.6)', () => {
  it('[PLAY-15] the look lasts while the effect resolves and is over when it finishes: it ends before the event card leaves the resolution zone, and the cards are hidden again', () => {
    const s0 = mainPhase({ hand: ['LT3'] });
    let r = playEvent(s0, 'LT3');
    // Mid-effect: still looking.
    expect(r.state.resolving).not.toBeNull();
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1', 'R0']);

    const [b1, y1, r0] = r.state.players[0].deck.slice(-3).reverse() as [CardId, CardId, CardId];
    r = then(r, choose(0, r0), choose(0, b1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_EVENT',
      'move:play:LT3:hand->resolution',
      'effect:lookTop',
      'look:B1,Y1,R0',
      'action:CHOOSE_CARD',
      'action:CHOOSE_CARD',
      'arranged:top3:bottom0',
      'lookEnd',
      'move:eventResolved:LT3:resolution->waiting',
      'playTiming:0:main',
    ]);
    // The chosen order: R0 highest, then B1, then Y1.
    expect(r.state.players[0].deck.slice(-3).reverse()).toEqual([r0, b1, y1]);
    // Back to the state before the look: no player sees those deck cards any more.
    expect(r.state.resolving).toBeNull();
    expect(projectView(r.state, 0).look).toBeNull();
    expect(projectView(r.state, 1).look).toBeNull();
    expect(r.events.filter((e) => e.kind === 'lookEnd')).toHaveLength(1);
  });

  it('[PLAY-15] a looked-at card that moves to another zone stops being looked at at once, while the others stay looked at until they are put back', () => {
    const s0 = mainPhase({ hand: ['LTS'] });
    let r = playEvent(s0, 'LTS');
    const [b1, y1, r0] = r.state.players[0].deck.slice(-3).reverse() as [CardId, CardId, CardId];
    expect(pendingKind(r.state)).toBe('pick:0:lookTake');
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1', 'R0']);

    // B1 goes to the stock (a hidden zone): it is no longer one of the looked-at cards.
    r = then(r, choose(0, b1));
    expect(defsIn(r.state, 0, 'stock')).toEqual(['B1']);
    expect(pendingKind(r.state)).toBe('pick:0:orderTop');
    expect(projectView(r.state, 0).look).toEqual({ player: 0, count: 2, cards: [y1, r0].map((id) => ({ id, def: defOf(r.state, id) })) });
    expect(projectView(r.state, 1).look).toEqual({ player: 0, count: 2, cards: null });
    // The look has not ended for the other two yet.
    expect(r.events.filter((e) => e.kind === 'lookEnd')).toEqual([]);

    r = then(r, choose(0, y1));
    expect(trace(r.state, r.events).slice(-5)).toEqual(['action:CHOOSE_CARD', 'arranged:top2:bottom0', 'lookEnd', 'move:eventResolved:LTS:resolution->waiting', 'playTiming:0:main']);
    expect(projectView(r.state, 0).look).toBeNull();
  });

  it('[PLAY-15] cards put back on top in a chosen order stop being looked at then, even though the effect goes on to another step', () => {
    const s0 = mainPhase({ hand: ['LTM'] });
    let r = playEvent(s0, 'LTM');
    const [b1, y1] = r.state.players[0].deck.slice(-2).reverse() as [CardId, CardId];
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1']);

    // Leave them in their original places: that choice ends the look for both.
    r = then(r, choose(0, b1));
    expect(pendingKind(r.state)).toBe('optional:0:may');
    expect(r.state.resolving).not.toBeNull();
    expect(projectView(r.state, 0).look).toBeNull();
    expect(trace(r.state, r.events).slice(-4)).toEqual(['action:CHOOSE_CARD', 'arranged:top2:bottom0', 'lookEnd', 'effect:may']);
    expect(r.state.players[0].deck.slice(-2).reverse()).toEqual([b1, y1]);

    // The rest of the effect runs without the look: the draw takes B1, which nobody is looking at any more.
    r = then(r, accept(0));
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
    expect(r.events.filter((e) => e.kind === 'lookEnd')).toHaveLength(1);
    expect(pendingKind(r.state)).toBe('play:0:main');
  });

  it('[PLAY-15] a single card put on the bottom is moved within the deck: its look ends there, before the rest of the effect', () => {
    const s0 = mainPhase({ hand: ['LBM'] });
    const r = playEvent(s0, 'LBM');
    const b1 = cardIn(s0, 0, 'deck', 'B1');

    expect(pendingKind(r.state)).toBe('optional:0:may');
    expect(r.state.resolving).not.toBeNull();
    expect(trace(r.state, r.events)).toEqual(['action:PLAY_EVENT', 'move:play:LBM:hand->resolution', 'effect:lookTop', 'look:B1', 'arranged:top0:bottom1', 'lookEnd', 'effect:may']);
    expect(r.state.players[0].deck[0]).toBe(b1);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['B1', 'G0', 'B0', 'R0', 'Y1']);
    expect(projectView(r.state, 0).look).toBeNull();
  });

  it('[PLAY-15] looked-at cards put into the waiting room are no longer looked at: when the next step starts, no look remains', () => {
    const s0 = mainPhase({ hand: ['LWM'] });
    const r = playEvent(s0, 'LWM');

    expect(pendingKind(r.state)).toBe('optional:0:may');
    expect(r.state.resolving).not.toBeNull();
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['B1', 'Y1']);
    expect(projectView(r.state, 0).look).toBeNull();
    const t = trace(r.state, r.events);
    expect(t.filter((x) => x === 'lookEnd')).toHaveLength(1);
    // The look is over no later than the moves out of the deck, and before the next step.
    expect(t.indexOf('lookEnd')).toBeLessThan(t.indexOf('move:effect:B1:deck->waiting'));
    expect(t.indexOf('move:effect:Y1:deck->waiting')).toBeLessThan(t.indexOf('effect:may'));
  });

  it('[PLAY-15] an "up to" look stopped after some cards ends for those cards too once they are put back; the cards below were never looked at', () => {
    const s0 = mainPhase({ hand: ['LUS'] });
    let r = then(playEvent(s0, 'LUS'), accept(0), accept(0), pass(0));
    // Take nothing; the two looked-at cards go to the bottom in a chosen order.
    r = then(r, pass(0));
    expect(pendingKind(r.state)).toBe('pick:0:orderBottom');
    expect(lookedDefs(r.state, 0)).toEqual(['B1', 'Y1']);
    const y1 = cardIn(r.state, 0, 'deck', 'Y1');
    r = then(r, choose(0, y1));

    // First pick ends highest within the bottom group: Y1 above B1, both under G0.
    expect(defsIn(r.state, 0, 'deck')).toEqual(['B1', 'Y1', 'G0', 'B0', 'R0']);
    expect(trace(r.state, r.events).slice(-4)).toEqual(['arranged:top0:bottom2', 'lookEnd', 'move:eventResolved:LUS:resolution->waiting', 'playTiming:0:main']);
    expect(projectView(r.state, 0).look).toBeNull();
  });

  it('[PLAY-15] one looked-at card put back on top keeps its place, and its look ends right then, before the effect goes on to its next step', () => {
    // Two ways to end up with a single card to put back: a fixed look at 1, and an "up to 3" look stopped after the first card.
    const fixed = playEvent(mainPhase({ hand: ['L1M'] }), 'L1M');
    const upTo = then(playEvent(mainPhase({ hand: ['LUM'] }), 'LUM'), accept(0), pass(0));

    for (const r of [fixed, upTo]) {
      // The next step ("you may draw") is waiting, so the effect is still resolving...
      expect(pendingKind(r.state)).toBe('optional:0:may');
      expect(r.state.resolving).not.toBeNull();
      // ...but B1 is no longer looked at: for the looker or the opponent.
      expect(looks(r.state, r.events)).toEqual([['B1']]);
      expect(projectView(r.state, 0).look).toBeNull();
      expect(projectView(r.state, 1).look).toBeNull();
      const t = trace(r.state, r.events);
      expect(t.filter((x) => x === 'lookEnd')).toHaveLength(1);
      expect(t.indexOf('lookEnd')).toBeLessThan(t.indexOf('effect:may'));
      // B1 stayed where it was, as the same object.
      expect(defsIn(r.state, 0, 'deck')).toEqual(DECK5);
    }
    expect(trace(upTo.state, upTo.events).slice(-3)).toEqual(['optional:lookMore:no', 'lookEnd', 'effect:may']);
  });

  it('[PLAY-15] looked-at cards that leave the deck stop being looked at for good: shuffled back in by a refresh during the effect, they are new cards with nothing left to put back in order', () => {
    // Deck of exactly 2 (Y1 on top); the waiting room holds 3 more cards for the refresh.
    const s0 = mainPhase({ deck: ['R0', 'Y1'], hand: ['LTW'], waiting: ['G0', 'B0', 'G0'] });
    let r = playEvent(s0, 'LTW');
    const y1 = cardIn(s0, 0, 'deck', 'Y1');
    const r0 = cardIn(s0, 0, 'deck', 'R0');
    expect(pendingKind(r.state)).toBe('pick:0:lookTake');
    expect(lookedDefs(r.state, 0)).toEqual(['Y1', 'R0']);

    // Both looked-at cards go to the waiting room; the deck is empty, so a refresh shuffles them back in.
    r = then(r, choose(0, y1), choose(0, r0));
    const t = trace(r.state, r.events);
    expect(t.filter((x) => x === 'refresh')).toHaveLength(1);
    expect(t.indexOf('move:effect:R0:deck->waiting')).toBeLessThan(t.indexOf('refresh'));
    // Precondition for this check: both cards are back in the deck (neither became the refresh point).
    expect(r.state.players[0].deck).toEqual(expect.arrayContaining([y1, r0]));
    expect(r.state.cards[y1]?.epoch).not.toBe(s0.cards[y1]?.epoch);
    expect(r.state.cards[r0]?.epoch).not.toBe(s0.cards[r0]?.epoch);

    // They are not looked-at cards any more: no order to choose, nothing rearranged, the effect is over.
    expect(t.filter((x) => x.startsWith('arranged'))).toEqual([]);
    expect(t.filter((x) => x === 'lookEnd')).toHaveLength(1);
    expect(pendingKind(r.state)).toBe('play:0:main');
    expect(r.state.resolving).toBeNull();
    expect(projectView(r.state, 0).look).toBeNull();
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['LTW']);
  });
});
