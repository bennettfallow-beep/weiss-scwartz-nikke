// Untrusted input must come back as an error value, never an exception, and
// must never corrupt the state (M1 definition of done, item 3).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { actionKey, applyAction, checkInvariants, createGame, legalActions, projectView, validate } from '../../src/engine';
import type { Action, GameState } from '../../src/engine';
import { act, cardIn, makeState } from '../../src/engine/testkit';
import { catalog, legalDeck } from '../helpers/catalog';

const decks = (): [string[], string[]] => [legalDeck('yellow'), legalDeck('red')];

function newGame(seed = 'robust'): GameState {
  const g = createGame({ seed, decks: decks() }, catalog);
  if (!g.ok) throw new Error('setup failed');
  return g.state;
}

/** A few states, one per kind of pending decision. */
function sampleStates(): GameState[] {
  const mulligan = newGame();
  const main = makeState(catalog, { start: 'main', players: [{ hand: ['Y0', 'Y1', 'YE0'], level: ['Y0'], stock: ['Y0'], stage: { 1: 'Y0' }, deck: ['Y0', 'Y0'] }, { deck: ['R0'] }] });
  const clock = makeState(catalog, { start: 'clock', players: [{ hand: ['Y0', 'Y1'], deck: ['Y0', 'Y0', 'Y0'] }, { deck: ['R0'] }] });
  const discard = makeState(catalog, { start: 'end', players: [{ hand: Array<string>(9).fill('Y0'), deck: ['Y0'] }, { deck: ['R0'] }] });
  const levelUp = makeState(catalog, { start: 'main', players: [{ clock: Array<string>(7).fill('Y0'), deck: ['Y0'] }, { deck: ['R0'] }] });
  return [mulligan, main, clock, discard, levelUp, ...combatStates()];
}

/** Combat decisions: the attack prompt, the counter window, an optional choice, a yes/no, and Encore. */
function combatStates(): GameState[] {
  const cat = catalog;
  const attack = makeState(cat, { start: 'attack', players: [{ deck: ['Y0', 'Y0', 'Y0'], stage: { 1: 'Y1', 2: 'Y2' } }, { deck: ['R0', 'R0', 'R0'], stage: { 2: 'R1' }, hand: ['RC0'], stock: ['R0'] }] });
  const counter = act(attack, cat, { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' });
  const confirm = act(makeState(cat, { start: 'attack', players: [{ deck: ['Y0', 'Y0', 'BX'], stage: { 1: 'Y1' } }, { deck: ['R0', 'R0', 'R0'] }] }), cat, {
    type: 'ATTACK',
    player: 0,
    slot: 1,
    attack: 'direct',
  });
  const encore = makeState(cat, { start: 'main', players: [{ deck: ['Y0', 'Y0'], hand: ['Y0'], stock: ['Y0', 'Y0', 'Y0'], stage: { 1: 'Y1' } }, { deck: ['R0'] }] });
  const encorePrompt = act(encore, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(encore, 0, 'hand', 'Y0'), slot: 1 });
  return [attack, counter, confirm, encorePrompt];
}

const anyAction = fc.oneof(
  fc.anything(),
  fc.record({
    type: fc.constantFrom(
      'MULLIGAN',
      'CLOCK',
      'PLAY_CHARACTER',
      'PLAY_EVENT',
      'PLAY_CLIMAX',
      'SWAP',
      'PASS',
      'LEVEL_UP',
      'CHOOSE_INTERRUPT',
      'DISCARD',
      'REORDER',
      'CONCEDE',
      'ATTACK',
      'BACKUP',
      'ORDER_ICON',
      'CHOOSE_CARD',
      'CHOOSE_SLOT',
      'CHOOSE_DEST',
      'ACCEPT',
      'ORDER_AUTO',
      'NOPE',
    ),
    player: fc.oneof(fc.constantFrom(0, 1), fc.anything()),
    card: fc.oneof(fc.string(), fc.constant(null), fc.anything()),
    slot: fc.oneof(fc.integer({ min: -1, max: 7 }), fc.anything()),
    a: fc.anything(),
    b: fc.anything(),
    zone: fc.oneof(fc.constantFrom('hand', 'waiting', 'clock', 'deck'), fc.anything()),
    discard: fc.anything(),
    cards: fc.anything(),
    order: fc.anything(),
    interrupt: fc.anything(),
    attack: fc.oneof(fc.constantFrom('direct', 'frontal', 'side'), fc.anything()),
    icon: fc.oneof(fc.constantFrom('soul', 'pool', 'draw', 'nope'), fc.anything()),
    dest: fc.oneof(fc.constantFrom('hand', 'stock', 'deck'), fc.anything()),
    auto: fc.oneof(fc.integer({ min: -2, max: 400 }), fc.anything()),
  }),
);

describe('untrusted input', () => {
  it('validate and applyAction never throw, and accepted actions keep every invariant', () => {
    const states = sampleStates();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: states.length - 1 }), anyAction, (i, raw) => {
        const s = states[i] as GameState;
        const v = validate(s, catalog, raw as Action);
        const r = applyAction(s, catalog, raw as Action);
        expect(r.ok).toBe(v.ok);
        if (r.ok) expect(checkInvariants(r.state, catalog)).toEqual([]);
      }),
      { numRuns: 3000 },
    );
  });

  it('rejects the malformed shapes found in review without throwing', () => {
    const s = newGame();
    const p = s.pending?.player ?? 0;
    for (const raw of [
      { type: 'MULLIGAN', player: p },
      { type: 'MULLIGAN', player: p, discard: 5 },
      { type: 'MULLIGAN', player: p, discard: null },
      { type: 'DISCARD', player: p, cards: {} },
      { type: 'DISCARD', player: p },
    ]) {
      const v = validate(s, catalog, raw as unknown as Action);
      expect(v.ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('rejects a REORDER that is not exactly the same cards (nested arrays, duplicates, missing)', () => {
    const s = newGame();
    const p = s.pending?.player ?? 0;
    const hand = s.players[p].hand;
    const tries = [
      hand.map((id) => [id]),
      [...hand.slice(0, -1), hand[0]],
      hand.slice(1),
      [...hand, hand[0]],
    ];
    for (const order of tries) {
      const r = applyAction(s, catalog, { type: 'REORDER', player: p, zone: 'hand', order } as unknown as Action);
      expect(r.ok, JSON.stringify(order)).toBe(false);
    }
    const ok = applyAction(s, catalog, { type: 'REORDER', player: p, zone: 'hand', order: [...hand].reverse() });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(checkInvariants(ok.state, catalog)).toEqual([]);
  });

  it('keeps only the fields an action type defines', () => {
    const s = newGame();
    const p = s.pending?.player ?? 0;
    const self: Record<string, unknown> = { type: 'CONCEDE', player: p, junk: 'x' };
    self.self = self; // a self-referencing object must not overflow the stack
    const r = applyAction(s, catalog, self as unknown as Action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const logged = r.events.find((e) => e.kind === 'action');
      expect(logged?.kind === 'action' ? logged.action : null).toEqual({ type: 'CONCEDE', player: p });
    }
  });

  it('createGame rejects bad setups with errors instead of throwing', () => {
    const proto = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__', '__defineSetter__', '__lookupSetter__'];
    const deck = [...proto.flatMap((n) => [n, n, n, n]), 'Y0', 'Y0'];
    const r = createGame({ seed: 's', decks: [deck, legalDeck('red')] }, catalog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'DECK_UNKNOWN_CARD')).toBe(true);

    const notArrays = createGame({ seed: 's', decks: ['abc', 'def'] } as never, catalog);
    expect(notArrays.ok).toBe(false);
    const noSeed = createGame({ decks: decks() } as never, catalog);
    expect(noSeed.ok).toBe(false);
    const nothing = createGame(null as never, catalog);
    expect(nothing.ok).toBe(false);
  });
});

describe('card data the engine cannot run is rejected up front', () => {
  it('createGame refuses unknown or malformed trigger icons and a non-boolean counter flag (found in M2 review)', () => {
    for (const bad of [{ triggers: ['bogus'] }, { triggers: 'soul' }, { triggers: 5 }, { counter: 'yes' }]) {
      const cat = { ...catalog, YX: { ...catalog.YX, ...bad } } as unknown as typeof catalog;
      const r = createGame({ seed: 's', decks: decks() }, cat);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.code === 'CATALOG_TRIGGER' || e.code === 'CATALOG_FIELD')).toBe(true);
    }
    expect(createGame({ seed: 's', decks: decks() }, catalog).ok).toBe(true);
  });
});

describe('validation agrees with the legal action list', () => {
  it('MULLIGAN and DISCARD: validate accepts exactly the listed sets, in any order', () => {
    const states = [newGame('oracle-1'), makeState(catalog, { start: 'end', players: [{ hand: ['Y0', 'Y1', 'Y2', 'Y3', 'R0', 'R1', 'B0', 'B1', 'G0'], deck: ['Y0'] }, { deck: ['R0'] }] })];
    for (const s of states) {
      const p = s.pending?.player ?? 0;
      const legalKeys = new Set(legalActions(s, catalog).map(actionKey));
      const hand = s.players[p].hand;
      fc.assert(
        fc.property(fc.subarray([...hand, 'p9-99']), fc.boolean(), (pick, dup) => {
          const cards = dup && pick.length > 0 ? [...pick, pick[0] as string] : pick;
          const action: Action = s.pending?.kind === 'mulligan' ? { type: 'MULLIGAN', player: p, discard: cards } : { type: 'DISCARD', player: p, cards };
          expect(validate(s, catalog, action).ok).toBe(legalKeys.has(actionKey(action)));
          const reversed: Action = action.type === 'MULLIGAN' ? { ...action, discard: [...action.discard].reverse() } : action.type === 'DISCARD' ? { ...action, cards: [...action.cards].reverse() } : action;
          expect(validate(s, catalog, reversed).ok).toBe(validate(s, catalog, action).ok);
        }),
        { numRuns: 400 },
      );
    }
  });
});

describe('shuffles players cannot steer (CR 3.2.4)', () => {
  it('decklist order does not change the shuffled deck', () => {
    const d = decks();
    const a = createGame({ seed: 'same', decks: d }, catalog);
    const b = createGame({ seed: 'same', decks: [[...d[0]].reverse(), [...d[1]].reverse()] }, catalog);
    if (!a.ok || !b.ok) throw new Error('setup failed');
    const defs = (s: GameState) => [0, 1].map((p) => [...s.players[p as 0 | 1].deck, ...s.players[p as 0 | 1].hand].map((id) => s.cards[id]?.def));
    expect(defs(b.state)).toEqual(defs(a.state));
  });

  it('reordering the waiting room before a refresh does not change the refreshed deck', () => {
    // Clock phase with one card in deck: clocking a card draws two, the first draw empties the
    // deck and the refresh shuffles the waiting room. Reordering the waiting room first must not
    // change the result.
    const start = makeState(catalog, { start: 'clock', players: [{ hand: ['G0'], waiting: ['Y0', 'Y1', 'Y2', 'Y3', 'R0', 'R1', 'B1'], deck: ['B0'] }, { deck: ['R0'] }] });
    const clock: Action = { type: 'CLOCK', player: 0, card: cardIn(start, 0, 'hand', 'G0') };
    const plain = act(start, catalog, clock);
    const reordered = act(start, catalog, { type: 'REORDER', player: 0, zone: 'waiting', order: [...start.players[0].waiting].reverse() }, clock);
    const refreshed = (s: GameState) => s.log.some((e) => e.kind === 'refresh');
    expect(refreshed(plain) && refreshed(reordered)).toBe(true);
    const defs = (s: GameState) => [...s.players[0].deck, ...s.players[0].clock, ...s.players[0].hand].map((id) => s.cards[id]?.def);
    expect(defs(reordered)).toEqual(defs(plain));
  });
});

describe('views are copies', () => {
  it('logged events are frozen and a view cannot be used to change the state', () => {
    const s = newGame();
    expect(s.log.every((e) => Object.isFrozen(e))).toBe(true);
    const view = projectView(s, s.pending?.player ?? 0);
    const before = JSON.stringify(s.pending);
    if (view.pending && 'player' in view.pending) (view.pending as { player: number }).player = 9;
    expect(JSON.stringify(s.pending)).toBe(before);
  });
});
