// Rule tests for zones (CR 3) and the zone-related basic concepts (CR 4.2,
// 4.3, 4.6, 4.7). Every title starts with its rules-matrix row id.
import { describe, expect, it } from 'vitest';

import {
  applyAction,
  BACK_STAGE,
  behind,
  CENTER_STAGE,
  createGame,
  facing,
  inFrontOf,
  isCenter,
  isPublicZone,
  legalActions,
  masterOf,
  nextInt,
  HIDDEN,
  projectView,
  seedRng,
  SLOTS,
  validate,
} from '../../src/engine';
import type { Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot, ZoneName } from '../../src/engine';
import { act, cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import { catalog, legalDeck } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const cadet = (letter: string): CardDef => ({
  id: `C${letter}`,
  name: `Lantern Cadet ${letter}`,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 1000,
  soul: 1,
});

const extra: CardDef[] = [
  ...'ABCDEFGHIJ'.split('').map(cadet),
  { id: 'CK', name: 'Lantern Hauler', kind: 'character', color: 'yellow', level: 0, cost: 2, power: 3000, soul: 1 },
  { id: 'EV', name: 'Flare Memo', kind: 'event', color: 'yellow', level: 0, cost: 1 },
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** A plain deck so nobody decks out. */
const deck = (): string[] => ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

type MoveEvent = Extract<GameEvent, { kind: 'move' }>;
const movesOf = (events: readonly GameEvent[]): MoveEvent[] => events.filter((e): e is MoveEvent => e.kind === 'move');
const newEvents = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const defOfId = (s: GameState, id: CardId | undefined): string | undefined => (id === undefined ? undefined : s.cards[id]?.def);

/** Every card on a stage position as [slot, def, orientation]. */
function stageOf(s: GameState, player: PlayerId): [Slot, string | undefined, string][] {
  return s.players[player].stage.flatMap((cards, i) => cards.map((c) => [(i + 1) as Slot, defOfId(s, c.id), c.orientation] as [Slot, string | undefined, string]));
}

/** The error code applyAction gives, or 'ok'. Accepts deliberately malformed actions. */
function attempt(s: GameState, action: unknown): string {
  const r = applyAction(s, cat, action as Action);
  return r.ok ? 'ok' : r.error.code;
}

const ALL_ZONES: readonly ZoneName[] = ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'resolution', 'stage', 'climax'];

function actualCounts(s: GameState, player: PlayerId): Record<ZoneName, number> {
  const p = s.players[player];
  return {
    deck: p.deck.length,
    hand: p.hand.length,
    waiting: p.waiting.length,
    clock: p.clock.length,
    level: p.level.length,
    stock: p.stock.length,
    memory: p.memory.length,
    resolution: p.resolution.length,
    stage: p.stage.reduce((n, cards) => n + cards.length, 0),
    climax: p.climax.length,
  };
}

/** True when the JSON of `value` mentions this card instance id anywhere. */
const mentions = (value: unknown, id: CardId): boolean => JSON.stringify(value).includes(`"${id}"`);

/** Plays seeded random legal actions (like the smoke test) and returns every state visited. */
function randomWalk(seed: string, steps: number): GameState[] {
  const created = createGame({ seed, decks: [legalDeck('yellow'), legalDeck('red')] }, catalog);
  if (!created.ok) throw new Error('setup failed');
  let s = created.state;
  let rng = seedRng(`walk-${seed}`);
  const states = [s];
  for (let i = 0; i < steps && !s.result; i++) {
    const legal = legalActions(s, catalog);
    const [pick, next] = nextInt(rng, legal.length);
    rng = next;
    s = act(s, catalog, legal[pick] as Action);
    states.push(s);
  }
  return states;
}

// --- 3.1 Basic information of zones -------------------------------------------

describe('3.1 zones in general', () => {
  it("[ZONE-01] each player has their own set of every zone, and putting cards into one player's zone leaves the other player's zones alone", () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: ['CA', 'CB'] },
        { deck: deck(), hand: ['CC'], stage: { 1: 'CD' } },
      ],
      start: 'clock',
    });
    for (const player of [0, 1] as const) {
      const p = s.players[player];
      for (const zone of ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'resolution', 'climax'] as const) {
        expect(Array.isArray(p[zone])).toBe(true);
      }
      expect(p.stage).toHaveLength(5);
    }
    // The two players' zones are separate objects, not one shared zone.
    for (const zone of ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'resolution', 'climax', 'stage'] as const) {
      expect(s.players[0][zone]).not.toBe(s.players[1][zone]);
    }

    const opponentBefore = JSON.stringify(s.players[1]);
    const after = act(
      s,
      cat,
      { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CA') },
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'CB'), slot: 1 },
    );
    // Player 0's clock, hand and position 1 changed; player 1's same-named zones did not.
    expect(defsIn(after, 0, 'clock')).toEqual(['CA']);
    expect(stageOf(after, 0)).toEqual([[1, 'CB', 'stand']]);
    expect(JSON.stringify(after.players[1])).toBe(opponentBefore);
    const view = projectView(after, 1);
    expect(view.players[0].counts.clock).toBe(1);
    expect(view.players[1].counts.clock).toBe(0);
    expect(view.players[1].stage[0]?.map((c) => c.def)).toEqual(['CD']);
  });

  it('[ZONE-02] deck, hand and stock are hidden zones and the rest are public', () => {
    const hidden = ALL_ZONES.filter((z) => !isPublicZone(z));
    expect(hidden.sort()).toEqual(['deck', 'hand', 'stock']);
  });

  it('[ZONE-02] the number of cards in every zone, hidden ones included, is shown to both players', () => {
    const s = makeState(cat, {
      players: [
        {
          deck: ['G0', 'G0', 'G0'],
          hand: ['CA', 'CB'],
          waiting: ['CC', 'CD'],
          clock: ['CE'],
          level: ['CF'],
          stock: ['G0', 'G0', 'G0', 'G0'],
          memory: ['CG'],
          resolution: ['CH'],
          stage: { 1: 'CI', 5: 'CJ' },
          climax: ['YX'],
        },
        { deck: deck(), hand: ['CA'] },
      ],
      start: 'main',
    });
    for (const viewer of [0, 1] as const) {
      const view = projectView(s, viewer);
      for (const owner of [0, 1] as const) {
        expect(view.players[owner].counts).toEqual(actualCounts(s, owner));
      }
    }
    // The counts are open even though the contents are not.
    const opp = projectView(s, 1).players[0];
    expect(opp.counts).toMatchObject({ deck: 3, hand: 2, stock: 4, waiting: 2, clock: 1, level: 1, memory: 1, resolution: 1, stage: 2, climax: 1 });
    expect(opp.hand).toBeNull();
    expect(opp).not.toHaveProperty('deck');
    expect(opp).not.toHaveProperty('stock');
    // Public zones show their card information to the opponent, in order.
    const p0 = s.players[0];
    expect(opp.waiting.map((c) => c.id)).toEqual(p0.waiting);
    expect(opp.clock.map((c) => c.id)).toEqual(p0.clock);
    expect(opp.level.map((c) => c.id)).toEqual(p0.level);
    expect(opp.memory.map((c) => c.id)).toEqual(p0.memory);
    expect(opp.resolution.map((c) => c.id)).toEqual(p0.resolution);
    expect(opp.climax.map((c) => c.id)).toEqual(p0.climax.map((c) => c.id));
    expect(opp.stage.map((cards) => cards.map((c) => c.id))).toEqual(p0.stage.map((cards) => cards.map((c) => c.id)));
    expect(opp.memory.map((c) => c.def)).toEqual(['CG']);
  });

  it('[ZONE-02] zone counts stay accurate for both viewers at every decision of a played-out game', () => {
    const states = randomWalk('zone-02', 120);
    expect(states.length).toBeGreaterThan(20);
    const pendingKinds = new Set<string>();
    for (const s of states) {
      if (s.pending) pendingKinds.add(s.pending.kind);
      for (const viewer of [0, 1] as const) {
        const view = projectView(s, viewer);
        for (const owner of [0, 1] as const) expect(view.players[owner].counts).toEqual(actualCounts(s, owner));
      }
    }
    // Checked across several kinds of decision, not only one.
    expect(pendingKinds.size).toBeGreaterThanOrEqual(3);
  });

  it('[ZONE-03] a card that moves to another zone becomes a new object, but a move between stage positions keeps the same object', () => {
    let s = makeState(cat, {
      players: [{ deck: deck(), hand: ['CA', 'CC'], stage: { 1: { def: 'CB', orientation: 'rest' } } }, { deck: deck() }],
      start: 'main',
    });
    const a = cardIn(s, 0, 'hand', 'CA');
    const b = cardIn(s, 0, 'stage', 'CB');
    const epochOf = (st: GameState, id: CardId) => st.cards[id]?.epoch;
    const aInHand = epochOf(s, a);
    const bOnStage = epochOf(s, b);

    // Hand -> stage: a new object.
    s = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: a, slot: 2 });
    const aOnStage = epochOf(s, a);
    expect(aOnStage).not.toBe(aInHand);

    // Stage position -> stage position (into an empty position, and a two-card exchange): same object.
    s = act(s, cat, { type: 'SWAP', player: 0, a: 1, b: 4 }, { type: 'SWAP', player: 0, a: 2, b: 4 });
    expect(epochOf(s, b)).toBe(bOnStage);
    expect(epochOf(s, a)).toBe(aOnStage);
    // What applied to it on the stage (here, being rested) carries over with it.
    expect(stageOf(s, 0)).toEqual([
      [2, 'CB', 'rest'],
      [4, 'CA', 'stand'],
    ]);

    // Stage -> waiting room (pushed out by a new character): a new object again.
    s = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'CC'), slot: 4 });
    expect(s.players[0].waiting).toEqual([a]);
    expect(epochOf(s, a)).not.toBe(aOnStage);
  });

  it('[ZONE-03] over a played-out game every zone change makes a new object and only stage-to-stage moves keep it', () => {
    const states = randomWalk('zone-03', 200);
    let zoneChanges = 0;
    let stageMoves = 0;
    for (let i = 1; i < states.length; i++) {
      const prev = states[i - 1] as GameState;
      const cur = states[i] as GameState;
      const moves = movesOf(newEvents(prev, cur));
      for (const [id, inst] of Object.entries(cur.cards)) {
        const mine = moves.filter((e) => e.card === id);
        const kept = mine.filter((e) => e.from.zone === 'stage' && e.to.zone === 'stage').length;
        stageMoves += kept;
        zoneChanges += mine.length - kept;
        // Each zone change is a new object; a position-to-position move is not.
        expect(inst.epoch).toBe((prev.cards[id]?.epoch ?? 0) + mine.length - kept);
      }
    }
    expect(zoneChanges).toBeGreaterThan(30);
    expect(stageMoves).toBeGreaterThan(0);
  });

  it('[ZONE-04] cards put into a zone together (mulligan discards) land in the order their owner chose', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['CA', 'CB', 'CC'] }, { deck: deck(), hand: ['CD'] }],
      start: 'mulligan',
    });
    const a = cardIn(s, 0, 'hand', 'CA');
    const c = cardIn(s, 0, 'hand', 'CC');
    expect(validate(s, cat, { type: 'MULLIGAN', player: 0, discard: [c, a] }).ok).toBe(true);
    expect(validate(s, cat, { type: 'MULLIGAN', player: 0, discard: [a, c] }).ok).toBe(true);
    expect(defsIn(act(s, cat, { type: 'MULLIGAN', player: 0, discard: [c, a] }), 0, 'waiting')).toEqual(['CC', 'CA']);
    expect(defsIn(act(s, cat, { type: 'MULLIGAN', player: 0, discard: [a, c] }), 0, 'waiting')).toEqual(['CA', 'CC']);
  });

  it('[ZONE-04] cards discarded together for the hand limit land in the order their owner chose', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI'] }, { deck: deck() }],
      start: 'end',
    });
    expect(s.pending).toEqual({ kind: 'discard', player: 0, count: 2, picked: [] });
    const choose = (card: string): Action => ({ type: 'CHOOSE_CARD', player: 0, card });
    const b = cardIn(s, 0, 'hand', 'CB');
    const h = cardIn(s, 0, 'hand', 'CH');
    // Chosen one at a time; nothing moves until both are chosen, then they go together in that order.
    const first = act(s, cat, choose(h));
    expect(defsIn(first, 0, 'waiting')).toEqual([]);
    expect(first.pending).toEqual({ kind: 'discard', player: 0, count: 2, picked: [h] });
    expect(defsIn(act(first, cat, choose(b)), 0, 'waiting')).toEqual(['CH', 'CB']);
    expect(defsIn(act(s, cat, choose(b), choose(h)), 0, 'waiting')).toEqual(['CB', 'CH']);
  });

  it('[ZONE-04] after a level up sends six clock cards to the waiting room together, their owner can put them in any order', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), clock: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'] }, { deck: deck() }],
      start: 'main',
    });
    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'CD') });
    expect([...defsIn(after, 0, 'waiting')].sort()).toEqual(['CA', 'CB', 'CC', 'CE', 'CF', 'CG']);
    const wanted = [...after.players[0].waiting].reverse();
    const r = applyAction(after, cat, { type: 'REORDER', player: 0, zone: 'waiting', order: wanted });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].waiting).toEqual(wanted);
  });

  it('[ZONE-05] when public waiting-room cards go into the hidden deck, everyone learns how many went in but nobody learns their order', () => {
    const s = makeState(cat, {
      players: [{ deck: [], waiting: ['CA', 'CB', 'CC', 'CD', 'CE'] }, { deck: deck() }],
      start: 'main',
    });
    // A refresh moved all five cards into the deck, then one went to the clock.
    expect(s.players[0].deck).toHaveLength(4);
    expect(s.players[0].clock).toHaveLength(1);
    const oppView = projectView(s, 1);
    expect(oppView.players[0].counts.deck).toBe(4);
    const intoDeck = movesOf(oppView.log).filter((e) => e.to.player === 0 && e.to.zone === 'deck');
    expect(intoDeck).toHaveLength(5);

    // Two positions that differ only in the order of those deck cards look identical to every player.
    const permuted = ops.deepClone(s);
    permuted.players[0].deck.reverse();
    expect(permuted.players[0].deck).not.toEqual(s.players[0].deck);
    expect(projectView(permuted, 1)).toEqual(projectView(s, 1));
    expect(projectView(permuted, 0)).toEqual(projectView(s, 0));
  });

  it('[ZONE-06][CONC-04] a card sent to the waiting room without a named player goes to its owner, even from the other player\'s stage', () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: ['Z0'], stage: { 2: 'CA' } },
        { deck: deck(), hand: ['Z0', 'YE0'] },
      ],
      start: 'main',
    });
    const foreignZero = cardIn(s, 1, 'hand', 'Z0');
    const foreignEvent = cardIn(s, 1, 'hand', 'YE0');
    const ownZero = cardIn(s, 0, 'hand', 'Z0');
    // Only effects (M3) can put a card into another player's zone, so place them directly.
    const t = ops.deepClone(s);
    ops.moveCard(t, foreignZero, { player: 0, zone: 'stage', slot: 1 }, 'effect');
    ops.moveCard(t, foreignEvent, { player: 0, zone: 'stage', slot: 3 }, 'effect');
    ops.moveCard(t, ownZero, { player: 0, zone: 'stage', slot: 4 }, 'effect');

    const after = act(t, cat, { type: 'PASS', player: 0 }); // the next check timing removes all three
    expect([...after.players[1].waiting].sort()).toEqual([foreignEvent, foreignZero].sort());
    expect(after.players[0].waiting).toEqual([ownZero]);
    expect(stageOf(after, 0)).toEqual([[2, 'CA', 'stand']]);
    for (const e of movesOf(newEvents(t, after))) {
      expect(e.to).toEqual({ player: after.cards[e.card]?.owner, zone: 'waiting' });
    }
  });
});

// --- 3.2 Deck -------------------------------------------------------------------

describe('3.2 deck', () => {
  it('[ZONE-07] no player, not even the owner, may reorder the deck', () => {
    const s = makeState(cat, { players: [{ deck: ['CA', 'CB', 'CC'] }, { deck: deck() }], start: 'main' });
    const reversed = [...s.players[0].deck].reverse();
    expect(attempt(s, { type: 'REORDER', player: 0, zone: 'deck', order: reversed })).toBe('NOT_REORDERABLE');
    // Waiting on player 0, but REORDER is "any time": player 1 is refused for their own deck too.
    expect(attempt(s, { type: 'REORDER', player: 1, zone: 'deck', order: [...s.players[1].deck].reverse() })).toBe('NOT_REORDERABLE');
  });

  it('[ZONE-07] no player can see which cards are in the deck or in what order', () => {
    const s = makeState(cat, { players: [{ deck: ['CA', 'CB', 'CC', 'CD'], hand: ['CE'] }, { deck: ['CF', 'CG', 'CH'] }], start: 'main' });
    for (const viewer of [0, 1] as const) {
      const view = projectView(s, viewer);
      for (const owner of [0, 1] as const) {
        expect(view.players[owner]).not.toHaveProperty('deck');
        for (const id of s.players[owner].deck) expect(mentions(view, id)).toBe(false);
      }
    }
    const permuted = ops.deepClone(s);
    permuted.players[0].deck.reverse();
    permuted.players[1].deck.reverse();
    for (const viewer of [0, 1] as const) expect(projectView(permuted, viewer)).toEqual(projectView(s, viewer));
  });

  it('[ZONE-08][CONC-16] "draw two" takes the deck cards one at a time, top card first', () => {
    const s = makeState(cat, { players: [{ deck: ['G0', 'CA', 'CB', 'CC'], hand: ['CD'] }, { deck: deck() }], start: 'clock' });
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CD') });
    const draws = movesOf(newEvents(s, after)).filter((e) => e.reason === 'draw');
    // Two separate one-card moves, in deck order: the top (CC) then the new top (CB).
    expect(draws.map((e) => defOfId(after, e.card))).toEqual(['CC', 'CB']);
    for (const e of draws) {
      expect(e.from).toEqual({ player: 0, zone: 'deck' });
      expect(e.to).toEqual({ player: 0, zone: 'hand' });
    }
    expect(defsIn(after, 0, 'hand')).toEqual(['CC', 'CB']);
    expect(defsIn(after, 0, 'deck')).toEqual(['G0', 'CA']);
  });

  it('[ZONE-08][CONC-16] the mulligan redraw takes the replacement cards one at a time from the top', () => {
    const s = makeState(cat, { players: [{ deck: ['G0', 'CD', 'CE'], hand: ['CA', 'CB', 'CC'] }, { deck: deck(), hand: ['CF'] }], start: 'mulligan' });
    const after = act(s, cat, { type: 'MULLIGAN', player: 0, discard: [cardIn(s, 0, 'hand', 'CA'), cardIn(s, 0, 'hand', 'CB')] });
    const draws = movesOf(newEvents(s, after)).filter((e) => e.reason === 'draw' && e.to.player === 0);
    expect(draws.map((e) => defOfId(after, e.card))).toEqual(['CE', 'CD']);
    expect(defsIn(after, 0, 'hand')).toEqual(['CC', 'CE', 'CD']);
  });

  it('[ZONE-10] if the deck runs out between the two clock-phase draws, a refresh happens and then the second draw comes from the new deck', () => {
    const s = makeState(cat, {
      players: [{ deck: ['CA'], waiting: ['CB', 'CC', 'CD'], hand: ['CE'] }, { deck: deck() }],
      start: 'clock',
    });
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CE') });
    const events = newEvents(s, after);
    const idx = (pred: (e: GameEvent) => boolean) => events.findIndex(pred);
    const draws = movesOf(events).filter((e) => e.reason === 'draw');
    expect(draws).toHaveLength(2);
    const firstDraw = events.indexOf(draws[0] as GameEvent);
    const secondDraw = events.indexOf(draws[1] as GameEvent);
    const refresh = idx((e) => e.kind === 'refresh' && e.player === 0);
    const shuffle = idx((e) => e.kind === 'shuffle' && e.player === 0);
    const refreshClock = idx((e) => e.kind === 'move' && e.reason === 'refreshClock');
    // draw, [deck empty] refresh, shuffle, refresh point to clock, then the suspended draw resumes.
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(firstDraw);
    expect(shuffle).toBeGreaterThan(refresh);
    expect(refreshClock).toBeGreaterThan(shuffle);
    expect(secondDraw).toBeGreaterThan(refreshClock);
    expect(defOfId(after, draws[0]?.card)).toBe('CA');
    expect(['CB', 'CC', 'CD']).toContain(defOfId(after, draws[1]?.card));

    expect(after.players[0].hand).toHaveLength(2);
    expect(after.players[0].deck).toHaveLength(1);
    expect(after.players[0].waiting).toHaveLength(0);
    expect(defsIn(after, 0, 'clock')).toHaveLength(2);
    const refreshed = [...defsIn(after, 0, 'deck'), defsIn(after, 0, 'hand')[1], defsIn(after, 0, 'clock')[1]];
    expect(refreshed.sort()).toEqual(['CB', 'CC', 'CD']);
    expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[ZONE-10] contrast: with two cards left the draw finishes first and the refresh comes after it', () => {
    const s = makeState(cat, {
      players: [{ deck: ['CA', 'CB'], waiting: ['CC', 'CD'], hand: ['CE'] }, { deck: deck() }],
      start: 'clock',
    });
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CE') });
    const events = newEvents(s, after);
    const draws = movesOf(events).filter((e) => e.reason === 'draw');
    expect(draws.map((e) => defOfId(after, e.card))).toEqual(['CB', 'CA']);
    const refresh = events.findIndex((e) => e.kind === 'refresh');
    expect(refresh).toBeGreaterThan(events.indexOf(draws[1] as GameEvent));
  });

  it('[ZONE-12] game setup shuffles each deck into a seed-dependent random order, and each shuffle belongs to the deck owner', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const created = createGame({ seed: `zone-12-${i}`, decks: [legalDeck('yellow'), legalDeck('red')] }, catalog);
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const s = created.state;
      const shuffles = s.log.filter((e) => e.kind === 'shuffle');
      expect(shuffles.map((e) => (e.kind === 'shuffle' ? e.player : -1))).toEqual([0, 1]);
      for (const player of [0, 1] as const) {
        // Instance ids follow the decklist, so the full deck order (bottom..top, then the 5 drawn) is a permutation of them.
        const ids = [...s.players[player].deck, ...[...s.players[player].hand].reverse()];
        expect([...ids].sort()).toEqual(Array.from({ length: 50 }, (_, n) => `p${player}-${String(n).padStart(2, '0')}`));
      }
      orders.add(s.players[0].deck.join());
    }
    expect(orders.size).toBe(12);
  });

  it('[ZONE-12] a refresh shuffles the new deck into a seed-dependent order, and the shuffle belongs to the deck owner even on the opponent\'s turn', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const s = makeState(cat, {
        seed: `refresh-${i}`,
        active: 0,
        players: [{ deck: deck() }, { deck: [], waiting: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH'] }],
        start: 'main',
      });
      const shuffles = s.log.filter((e) => e.kind === 'shuffle');
      expect(shuffles.map((e) => (e.kind === 'shuffle' ? e.player : -1))).toEqual([1]);
      expect([...defsIn(s, 1, 'deck'), ...defsIn(s, 1, 'clock')].sort()).toEqual(['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH']);
      orders.add([...defsIn(s, 1, 'deck'), ...defsIn(s, 1, 'clock')].join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

// --- 3.3 Hand ------------------------------------------------------------------

describe('3.3 hand', () => {
  it('[ZONE-14][CONC-16] the draw-phase draw puts the top card of the deck into the hand', () => {
    const s = makeState(cat, { players: [{ deck: ['CA', 'CB', 'CC'] }, { deck: ['CD', 'CE'] }], start: 'draw' });
    expect(defsIn(s, 0, 'hand')).toEqual(['CC']);
    expect(defsIn(s, 0, 'deck')).toEqual(['CA', 'CB']);
    // Only the drawing player's own deck is used.
    expect(defsIn(s, 1, 'deck')).toEqual(['CD', 'CE']);
    expect(s.players[1].hand).toEqual([]);
  });

  it('[ZONE-14] the hand is hidden from the opponent (count only, drawn cards redacted) but always visible to its owner', () => {
    const s = makeState(cat, { players: [{ deck: ['CA', 'CB', 'CC'], hand: ['CD'] }, { deck: deck(), hand: ['CE', 'CF'] }], start: 'draw' });
    const drawn = cardIn(s, 0, 'hand', 'CC');
    const mine = projectView(s, 0);
    const theirs = projectView(s, 1);
    expect(mine.players[0].hand?.map((c) => c.def)).toEqual(['CD', 'CC']);
    expect(theirs.players[0].hand).toBeNull();
    expect(theirs.players[0].counts.hand).toBe(2);
    for (const id of s.players[0].hand) expect(mentions(theirs, id)).toBe(false);
    const drawOwner = movesOf(mine.log).find((e) => e.reason === 'draw' && e.to.player === 0);
    const drawOpp = movesOf(theirs.log).find((e) => e.reason === 'draw' && e.to.player === 0);
    expect(drawOwner?.card).toBe(drawn);
    expect(drawOpp?.card).toBe('?');
    // Player 1 is not the one being waited on, yet still sees their own hand.
    expect(s.pending?.player).toBe(0);
    expect(theirs.players[1].hand?.map((c) => c.def)).toEqual(['CE', 'CF']);
  });

  it('[ZONE-14] over a played-out game every draw is hidden from the opponent and shown to the drawing player', () => {
    const states = randomWalk('zone-14', 150);
    const last = states[states.length - 1] as GameState;
    const views = [projectView(last, 0), projectView(last, 1)] as const;
    let draws = 0;
    last.log.forEach((e, i) => {
      if (e.kind !== 'move' || e.from.zone !== 'deck' || e.to.zone !== 'hand') return;
      draws += 1;
      const owner = e.to.player;
      const opponent: PlayerId = owner === 0 ? 1 : 0;
      expect((views[owner].log[i] as MoveEvent).card).toBe(e.card);
      expect((views[opponent].log[i] as MoveEvent).card).toBe('?');
    });
    expect(draws).toBeGreaterThan(15);
    for (const s of states) {
      for (const viewer of [0, 1] as const) {
        const view = projectView(s, viewer);
        expect(view.players[viewer].hand?.map((c) => c.id)).toEqual(s.players[viewer].hand);
        expect(view.players[viewer === 0 ? 1 : 0].hand).toBeNull();
      }
    }
  });

  it('[ZONE-14] a player may reorder their own hand at any time, and the opponent does not learn the new order', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CA'] }, { deck: deck(), hand: ['CB', 'CC', 'CD'] }], start: 'main' });
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    const order = [...s.players[1].hand].reverse();
    const r = applyAction(s, cat, { type: 'REORDER', player: 1, zone: 'hand', order });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(defsIn(r.state, 1, 'hand')).toEqual(['CD', 'CC', 'CB']);
    expect(r.state.pending).toEqual(s.pending); // the decision being waited on is untouched
    const oppLog = projectView(r.state, 0).log;
    const reorder = oppLog.find((e) => e.kind === 'action' && e.action.type === 'REORDER');
    expect(reorder).toBeDefined();
    for (const id of order) expect(mentions(reorder, id)).toBe(false);
    // The order must be a rearrangement of the hand: nothing added, nothing taken from the opponent.
    expect(attempt(s, { type: 'REORDER', player: 1, zone: 'hand', order: [...order, cardIn(s, 0, 'hand', 'CA')] })).toBe('BAD_REORDER');
    expect(attempt(s, { type: 'REORDER', player: 1, zone: 'hand', order: s.players[0].hand })).toBe('BAD_REORDER');
  });

  it('[ZONE-15] in the turn player\'s End Phase a hand above seven must be cut down to exactly seven, into the waiting room', () => {
    const hand = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI'];
    const s = makeState(cat, { players: [{ deck: deck(), hand, climax: ['YX'] }, { deck: deck() }], start: 'end' });
    expect(s.phase).toBe('end');
    expect(s.pending).toEqual({ kind: 'discard', player: 0, count: 2, picked: [] });
    // The excess is chosen one card at a time: each hand card is an option until it is chosen.
    const legal = legalActions(s, cat);
    expect(legal).toHaveLength(9);
    expect(legal.every((a) => a.type === 'CHOOSE_CARD')).toBe(true);
    const ca = cardIn(s, 0, 'hand', 'CA');
    const once = act(s, cat, { type: 'CHOOSE_CARD', player: 0, card: ca });
    expect(legalActions(once, cat)).toHaveLength(8);
    expect(validate(once, cat, { type: 'CHOOSE_CARD', player: 0, card: ca }).ok).toBe(false);
    expect(validate(s, cat, { type: 'PASS', player: 0 }).ok).toBe(false);
    // The hand limit comes before the climax cleanup (6.8.1.2 then 6.8.1.3).
    expect(s.players[0].climax).toHaveLength(1);

    const after = act(s, cat, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'hand', 'CB') }, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'hand', 'CE') });
    expect(defsIn(after, 0, 'hand')).toEqual(['CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI']);
    expect(defsIn(after, 0, 'waiting')).toEqual(['CB', 'CE', 'YX']);
    expect(after.active).toBe(1);
  });

  it('[ZONE-15] contrast: eight cards means one discard, and exactly seven means none', () => {
    const eight = makeState(cat, { players: [{ deck: deck(), hand: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH'] }, { deck: deck() }], start: 'end' });
    expect(eight.pending).toEqual({ kind: 'discard', player: 0, count: 1, picked: [] });
    const seven = makeState(cat, { players: [{ deck: deck(), hand: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'] }, { deck: deck() }], start: 'end' });
    expect(seven.pending?.kind).not.toBe('discard');
    expect(seven.active).toBe(1);
    expect(seven.players[0].hand).toHaveLength(7);
    expect(seven.players[0].waiting).toEqual([]);
  });

  it('[ZONE-15] only the turn player is held to the limit: the non-turn player may end the turn holding more than seven', () => {
    const big = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI'];
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CJ'] }, { deck: deck(), hand: big }], start: 'end' });
    // Player 0's End Phase passed without asking player 1 anything; player 1 kept all nine.
    const handLimitMoves = movesOf(s.log).filter((e) => e.reason === 'handLimit');
    expect(handLimitMoves).toEqual([]);
    expect(s.players[1].waiting).toEqual([]);
    expect(s.active).toBe(1);
    // Player 1 is now the turn player: nine cards plus the draw-phase draw.
    expect(s.players[1].hand).toHaveLength(10);
    expect(s.pending).toEqual({ kind: 'clock', player: 1 });
  });

  it('[ZONE-15] contrast: a hand over the limit is not checked outside the End Phase', () => {
    const hand = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI'];
    const s = makeState(cat, { players: [{ deck: deck(), hand }, { deck: deck() }], start: 'main' });
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    const climax = act(s, cat, { type: 'PASS', player: 0 });
    expect(climax.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    const end = act(climax, cat, { type: 'PASS', player: 0 });
    expect(end.phase).toBe('end');
    expect(end.pending).toEqual({ kind: 'discard', player: 0, count: 2, picked: [] });
  });
});

// --- 3.4 Waiting room ------------------------------------------------------------

describe('3.4 waiting room', () => {
  it('[ZONE-16] paid costs, used events, removed characters and climaxes all go to the waiting room by default', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['EV', 'CA', 'YX'], stock: ['CJ', 'CI'], clock: ['CH'], stage: { 1: 'CB' } }, { deck: deck() }],
      start: 'main',
    });
    let t = act(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'EV') });
    t = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(t, 0, 'hand', 'CA'), slot: 1 });
    t = act(t, cat, { type: 'PASS', player: 0 }, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(t, 0, 'hand', 'YX') });
    t = act(t, cat, { type: 'PASS', player: 0 }); // no attack this turn
    const toWaiting = movesOf(newEvents(s, t)).filter((e) => e.to.zone === 'waiting');
    expect(toWaiting.map((e) => [defOfId(t, e.card), e.reason])).toEqual([
      ['CI', 'cost'], // stock paid for the event
      ['EV', 'eventResolved'], // the used event
      ['CB', 'ruleAction'], // the character removed from the stage
      ['YX', 'climaxCleanup'], // the climax at the end of the turn
    ]);
    for (const e of toWaiting) expect(e.to.player).toBe(0);
    expect(defsIn(t, 0, 'waiting')).toEqual(['CI', 'EV', 'CB', 'YX']);
  });

  it('[ZONE-16] a character removed for having 0 power goes to the waiting room', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 3: 'Z0' } }, { deck: deck() }], start: 'main' });
    expect(stageOf(s, 0)).toEqual([]);
    expect(defsIn(s, 0, 'waiting')).toEqual(['Z0']);
  });

  it('[ZONE-17] the waiting room is visible to the opponent, card by card and in order, and each new card goes on top', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['EV'], stock: ['CC'], waiting: ['CA', 'CB'] }, { deck: deck() }], start: 'main' });
    const after = act(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'EV') });
    expect(defsIn(after, 0, 'waiting')).toEqual(['CA', 'CB', 'CC', 'EV']);
    const opp = projectView(after, 1).players[0];
    expect(opp.waiting.map((c) => c.def)).toEqual(['CA', 'CB', 'CC', 'EV']);
    expect(opp.waiting.map((c) => c.id)).toEqual(after.players[0].waiting);
  });

  it('[ZONE-17] a player may reorder their own waiting room at any time, but not the opponent\'s', () => {
    const s = makeState(cat, { players: [{ deck: deck(), waiting: ['CA', 'CB'] }, { deck: deck(), waiting: ['CC', 'CD', 'CE'] }], start: 'main' });
    expect(s.pending?.player).toBe(0);
    // Player 1 is not being waited on and still may reorder their own waiting room.
    const order = [cardIn(s, 1, 'waiting', 'CE'), cardIn(s, 1, 'waiting', 'CC'), cardIn(s, 1, 'waiting', 'CD')];
    const r = applyAction(s, cat, { type: 'REORDER', player: 1, zone: 'waiting', order });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(defsIn(r.state, 1, 'waiting')).toEqual(['CE', 'CC', 'CD']);
      expect(r.state.pending).toEqual(s.pending);
    }
    // Player 1 cannot rearrange player 0's waiting room.
    expect(attempt(s, { type: 'REORDER', player: 1, zone: 'waiting', order: [...s.players[0].waiting].reverse() })).toBe('BAD_REORDER');
  });
});

// --- 3.5 / 3.6 Stage --------------------------------------------------------------

describe('3.5-3.6 stage and stage positions', () => {
  it('[ZONE-18] the stage has five positions: 1-3 are center stage (left to right) and 4-5 are back stage', () => {
    expect(SLOTS).toEqual([1, 2, 3, 4, 5]);
    expect(CENTER_STAGE).toEqual([1, 2, 3]);
    expect(BACK_STAGE).toEqual([4, 5]);
    expect(SLOTS.map((slot) => isCenter(slot))).toEqual([true, true, true, false, false]);
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CA'] }, { deck: deck() }], start: 'main' });
    expect(s.players[0].stage).toHaveLength(5);
    const card = cardIn(s, 0, 'hand', 'CA');
    const slots = legalActions(s, cat)
      .filter((a): a is Extract<Action, { type: 'PLAY_CHARACTER' }> => a.type === 'PLAY_CHARACTER' && a.card === card)
      .map((a) => a.slot);
    expect(slots).toEqual([1, 2, 3, 4, 5]);
  });

  it('[ZONE-18] a card on a back-stage position counts as being on the stage', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CA'] }, { deck: deck() }], start: 'main' });
    const card = cardIn(s, 0, 'hand', 'CA');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 5 });
    expect(ops.locate(after, card)).toMatchObject({ player: 0, zone: 'stage', slot: 5 });
    expect(projectView(after, 1).players[0].counts.stage).toBe(1);
    // The stand phase stands "all characters on the stage", back stage included.
    const rested = makeState(cat, { players: [{ deck: deck(), stage: { 4: { def: 'CA', orientation: 'rest' }, 5: { def: 'CB', orientation: 'reverse' } } }, { deck: deck() }], start: 'stand' });
    expect(stageOf(rested, 0)).toEqual([
      [4, 'CA', 'stand'],
      [5, 'CB', 'stand'],
    ]);
  });

  it('[ZONE-19] stage cards are face up: the opponent sees each card and its orientation', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 1: 'CA', 4: { def: 'CB', orientation: 'rest' } } }, { deck: deck() }], start: 'main' });
    const opp = projectView(s, 1).players[0];
    expect(opp.stage[0]).toEqual([{ id: cardIn(s, 0, 'stage', 'CA'), def: 'CA', orientation: 'stand' }]);
    expect(opp.stage[3]).toEqual([{ id: cardIn(s, 0, 'stage', 'CB'), def: 'CB', orientation: 'rest' }]);
  });

  it('[ZONE-19] a position holds one card: playing onto an occupied position sends the older character to the waiting room by rule action', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CB'], stage: { 2: 'CA' } }, { deck: deck() }], start: 'main' });
    const old = cardIn(s, 0, 'stage', 'CA');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'CB'), slot: 2 });
    expect(stageOf(after, 0)).toEqual([[2, 'CB', 'stand']]);
    expect(after.players[0].waiting).toEqual([old]);
    const rule = newEvents(s, after).find((e) => e.kind === 'ruleAction');
    expect(rule).toMatchObject({ kind: 'ruleAction', rule: 'extraCards', cards: [old] });
  });

  it('[ZONE-19] with two characters on one position only the one placed last stays; if both were placed last, both go', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 1: ['CA', 'CB'] } }, { deck: deck() }], start: 'main' });
    expect(stageOf(s, 0)).toEqual([[1, 'CB', 'stand']]);
    expect(defsIn(s, 0, 'waiting')).toEqual(['CA']);

    const base = makeState(cat, { players: [{ deck: deck(), stage: { 1: 'CC', 2: 'CD' } }, { deck: deck() }], start: 'main' });
    const tie = ops.deepClone(base);
    const [first] = tie.players[0].stage[0] ?? [];
    const [second] = tie.players[0].stage[1] ?? [];
    if (!first || !second) throw new Error('setup');
    // Two characters placed on position 1 at the same moment (only effects can do this).
    tie.players[0].stage[0] = [first, { ...second, placedAt: first.placedAt }];
    tie.players[0].stage[1] = [];
    const after = act(tie, cat, { type: 'PASS', player: 0 });
    expect(stageOf(after, 0)).toEqual([]);
    expect([...defsIn(after, 0, 'waiting')].sort()).toEqual(['CC', 'CD']);
  });

  it('[ZONE-20][CONC-14] a character played from hand arrives standing', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CA'] }, { deck: deck() }], start: 'main' });
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'CA'), slot: 3 });
    expect(stageOf(after, 0)).toEqual([[3, 'CA', 'stand']]);
  });

  it('[ZONE-20] characters moved between stage positions keep their orientation', () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), stage: { 1: { def: 'CA', orientation: 'rest' }, 2: { def: 'CB', orientation: 'reverse' }, 3: { def: 'CC', orientation: 'rest' } } },
        { deck: deck() },
      ],
      start: 'main',
    });
    const after = act(s, cat, { type: 'SWAP', player: 0, a: 1, b: 2 }, { type: 'SWAP', player: 0, a: 3, b: 5 });
    expect(stageOf(after, 0)).toEqual([
      [1, 'CB', 'reverse'],
      [2, 'CA', 'rest'],
      [5, 'CC', 'rest'],
    ]);
    expect(newEvents(s, after).filter((e) => e.kind === 'orientation')).toEqual([]);
  });

  it('[ZONE-20] a rested character that leaves the stage and is played again arrives standing, not in its old state', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 1: { def: 'CA', orientation: 'rest' } } }, { deck: deck() }], start: 'main' });
    const card = cardIn(s, 0, 'stage', 'CA');
    const t = ops.deepClone(s);
    // Returning a character to hand needs an effect (M3); move it directly.
    ops.moveCard(t, card, { player: 0, zone: 'hand' }, 'effect');
    const after = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    expect(stageOf(after, 0)).toEqual([[1, 'CA', 'stand']]);
  });

  it('[ZONE-21] positions pair front-to-back as 1-4, 2-4, 2-5 and 3-5', () => {
    expect(inFrontOf(4)).toEqual([1, 2]);
    expect(inFrontOf(5)).toEqual([2, 3]);
    expect(behind(1)).toEqual([4]);
    expect(behind(2)).toEqual([4, 5]);
    expect(behind(3)).toEqual([5]);
    // Center positions have nothing in front; back positions have nothing behind.
    for (const slot of CENTER_STAGE) expect(inFrontOf(slot)).toEqual([]);
    for (const slot of BACK_STAGE) expect(behind(slot)).toEqual([]);
    // The relation is the same read from either end.
    for (const front of CENTER_STAGE) for (const back of BACK_STAGE) expect(behind(front).includes(back)).toBe(inFrontOf(back).includes(front));
  });

  it('[ZONE-22] center positions face the opponent in mirror order (1-3, 2-2, 3-1) and back positions face nothing', () => {
    expect(facing(1)).toBe(3);
    expect(facing(2)).toBe(2);
    expect(facing(3)).toBe(1);
    expect(facing(4)).toBeNull();
    expect(facing(5)).toBeNull();
    for (const slot of CENTER_STAGE) expect(facing(facing(slot) as Slot)).toBe(slot);
  });

  it('[ZONE-23] an event or climax on a stage position goes to the waiting room by rule action at the check timing; a character stays', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 1: 'YE0', 2: 'CA', 4: 'YX' } }, { deck: deck() }], start: 'main' });
    expect(stageOf(s, 0)).toEqual([[2, 'CA', 'stand']]);
    expect([...defsIn(s, 0, 'waiting')].sort()).toEqual(['YE0', 'YX']);
    const ruleIdx = s.log.findIndex((e) => e.kind === 'ruleAction' && e.rule === 'illegalCard');
    expect(s.log[ruleIdx]).toMatchObject({ rule: 'illegalCard', players: [0] });
    const checkIdx = s.log.findIndex((e) => e.kind === 'checkTiming');
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(ruleIdx);
  });

  it("[ZONE-23] a non-character on a stage position goes to its owner's waiting room, not the stage owner's", () => {
    const s = makeState(cat, { players: [{ deck: deck() }, { deck: deck(), hand: ['YE0'] }], start: 'main' });
    const event = cardIn(s, 1, 'hand', 'YE0');
    const t = ops.deepClone(s);
    ops.moveCard(t, event, { player: 0, zone: 'stage', slot: 2 }, 'effect');
    // It is a check-type rule action: the card sits there until the next check timing.
    expect(stageOf(t, 0)).toEqual([[2, 'YE0', 'stand']]);
    const after = act(t, cat, { type: 'PASS', player: 0 });
    expect(stageOf(after, 0)).toEqual([]);
    expect(after.players[1].waiting).toEqual([event]);
    expect(after.players[0].waiting).toEqual([]);
    const events = newEvents(t, after);
    const check = events.findIndex((e) => e.kind === 'checkTiming');
    const rule = events.findIndex((e) => e.kind === 'ruleAction' && e.rule === 'illegalCard');
    expect(check).toBeGreaterThanOrEqual(0);
    expect(rule).toBeGreaterThan(check);
    expect(events[rule]).toMatchObject({ cards: [event], players: [1] });
  });
});

// --- 3.8 / 3.9 Clock and level ------------------------------------------------------

describe('3.8-3.9 clock and level', () => {
  it('[ZONE-27] a clocked card goes on top of the clock, and the opponent sees the clock cards in order', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CC'], clock: ['CA', 'CB'] }, { deck: deck() }], start: 'clock' });
    const after = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CC') });
    expect(defsIn(after, 0, 'clock')).toEqual(['CA', 'CB', 'CC']);
    const opp = projectView(after, 1);
    expect(opp.players[0].clock.map((c) => c.def)).toEqual(['CA', 'CB', 'CC']);
    const clocked = movesOf(opp.log).find((e) => e.reason === 'clock');
    expect(clocked?.card).toBe(cardIn(after, 0, 'clock', 'CC'));
  });

  it('[ZONE-27] the refresh card also goes on top of the clock', () => {
    const s = makeState(cat, { players: [{ deck: [], waiting: ['CC'], clock: ['CA', 'CB'] }, { deck: deck() }], start: 'main' });
    expect(defsIn(s, 0, 'clock')).toEqual(['CA', 'CB', 'CC']);
  });

  it('[ZONE-27] nobody may reorder the clock', () => {
    const s = makeState(cat, { players: [{ deck: deck(), clock: ['CA', 'CB'] }, { deck: deck(), clock: ['CC', 'CD'] }], start: 'main' });
    expect(attempt(s, { type: 'REORDER', player: 0, zone: 'clock', order: [...s.players[0].clock].reverse() })).toBe('NOT_REORDERABLE');
    expect(attempt(s, { type: 'REORDER', player: 1, zone: 'clock', order: [...s.players[1].clock].reverse() })).toBe('NOT_REORDERABLE');
  });

  it('[ZONE-28] reaching seven clock cards interrupts the clock-phase draw: one of the seven goes to level and the other six to the waiting room', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['CG'], clock: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF'] }, { deck: deck() }],
      start: 'clock',
    });
    const mid = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'CG') });
    // The level up comes before the two draws.
    expect(mid.pending?.kind).toBe('levelUp');
    expect(mid.players[0].hand).toEqual([]);
    const choices = legalActions(mid, cat);
    expect(choices.map((a) => (a.type === 'LEVEL_UP' ? defOfId(mid, a.card) : a.type)).sort()).toEqual(['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG']);

    const after = act(mid, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(mid, 0, 'clock', 'CD') });
    expect(defsIn(after, 0, 'level')).toEqual(['CD']);
    expect([...defsIn(after, 0, 'waiting')].sort()).toEqual(['CA', 'CB', 'CC', 'CE', 'CF', 'CG']);
    expect(after.players[0].clock).toEqual([]);
    expect(after.players[0].hand).toHaveLength(2);
  });

  it('[ZONE-28] only the bottom seven clock cards take part; cards above them stay in the clock', () => {
    const clock = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH'];
    const s = makeState(cat, { players: [{ deck: deck(), clock }, { deck: deck() }], start: 'main' });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    const top = cardIn(s, 0, 'clock', 'CH');
    expect(validate(s, cat, { type: 'LEVEL_UP', player: 0, card: top }).ok).toBe(false);
    expect(legalActions(s, cat)).toHaveLength(7);
    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'CA') });
    expect(defsIn(after, 0, 'clock')).toEqual(['CH']);
    expect(defsIn(after, 0, 'level')).toEqual(['CA']);
    expect([...defsIn(after, 0, 'waiting')].sort()).toEqual(['CB', 'CC', 'CD', 'CE', 'CF', 'CG']);
  });

  it('[ZONE-28] the clock owner makes the choice even on the opponent\'s turn; six clock cards cause no level up', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), clock: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF'] }, { deck: deck(), clock: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'] }],
      start: 'main',
    });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 1 });
    const after = act(s, cat, { type: 'LEVEL_UP', player: 1, card: cardIn(s, 1, 'clock', 'CB') });
    expect(defsIn(after, 1, 'level')).toEqual(['CB']);
    expect(after.players[0].level).toEqual([]);
    expect(after.players[0].clock).toHaveLength(6);
    expect(after.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[ZONE-29] a new level card goes on top of the level, which the opponent can see', () => {
    const s = makeState(cat, { players: [{ deck: deck(), level: ['CA'], clock: ['CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH'] }, { deck: deck() }], start: 'main' });
    const after = act(s, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'CE') });
    expect(defsIn(after, 0, 'level')).toEqual(['CA', 'CE']);
    expect(projectView(after, 1).players[0].level.map((c) => c.def)).toEqual(['CA', 'CE']);
    expect(projectView(after, 1).players[0].level.map((c) => c.id)).toEqual(after.players[0].level);
  });

  it('[ZONE-29] a player may not reorder their own level', () => {
    const s = makeState(cat, { players: [{ deck: deck(), level: ['CA', 'CB'] }, { deck: deck() }], start: 'main' });
    expect(attempt(s, { type: 'REORDER', player: 0, zone: 'level', order: [...s.players[0].level].reverse() })).toBe('NOT_REORDERABLE');
    expect(defsIn(s, 0, 'level')).toEqual(['CA', 'CB']);
  });
});

// --- 3.10 Stock -------------------------------------------------------------------

describe('3.10 stock', () => {
  it('[ZONE-31] stock cards are hidden from everyone, the owner included; only the count shows', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stock: ['CA', 'CB', 'CC'] }, { deck: deck() }], start: 'main' });
    for (const viewer of [0, 1] as const) {
      const view = projectView(s, viewer);
      expect(view.players[0]).not.toHaveProperty('stock');
      expect(view.players[0].counts.stock).toBe(3);
      for (const id of s.players[0].stock) expect(mentions(view, id)).toBe(false);
    }
    const permuted = ops.deepClone(s);
    permuted.players[0].stock.reverse();
    for (const viewer of [0, 1] as const) expect(projectView(permuted, viewer)).toEqual(projectView(s, viewer));
  });

  it('[ZONE-31] nobody may reorder the stock', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stock: ['CA', 'CB'] }, { deck: deck() }], start: 'main' });
    expect(attempt(s, { type: 'REORDER', player: 0, zone: 'stock', order: [...s.players[0].stock].reverse() })).toBe('NOT_REORDERABLE');
  });

  it('[ZONE-31] paying a cost takes stock cards from the top, one at a time in order', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['CK'], stock: ['CA', 'CB', 'CC', 'CD'] }, { deck: deck() }], start: 'main' });
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'CK'), slot: 1 });
    const paid = movesOf(newEvents(s, after)).filter((e) => e.reason === 'cost');
    expect(paid.map((e) => defOfId(after, e.card))).toEqual(['CD', 'CC']);
    for (const e of paid) expect(e.from).toEqual({ player: 0, zone: 'stock' });
    expect(defsIn(after, 0, 'stock')).toEqual(['CA', 'CB']);
    expect(defsIn(after, 0, 'waiting')).toEqual(['CD', 'CC']);
  });

  it('[ZONE-31] a trigger-checked card goes on top of the stock, face down to the opponent', () => {
    // Player 0 attacks directly; the revealed CC is put into stock after its (empty) trigger.
    const s = makeState(cat, { players: [{ deck: ['G0', 'CC'], stock: ['CA', 'CB'], stage: { 1: 'Y0' } }, { deck: deck() }], start: 'attack' });
    const after = act(s, cat, { type: 'ATTACK', player: 0, slot: 1, attack: 'direct' });
    expect(defsIn(after, 0, 'stock')).toEqual(['CA', 'CB', 'CC']);
    const toStock = movesOf(newEvents(s, after)).filter((e) => e.to.zone === 'stock');
    expect(toStock.map((e) => [defOfId(after, e.card), e.from.zone, e.reason])).toEqual([['CC', 'resolution', 'triggerToStock']]);
    // The opponent saw it revealed, but the move into the stock carries no card.
    expect(movesOf(projectView(after, 1).log.slice(s.log.length)).filter((e) => e.to.zone === 'stock').map((e) => e.card)).toEqual([HIDDEN]);
    expect(projectView(after, 1).players[0].counts.stock).toBe(3);
  });
});

// --- 3.11 Climax area ---------------------------------------------------------------

describe('3.11 climax area', () => {
  it('[ZONE-32] a played climax goes face up into the climax area, where the opponent can see it', () => {
    const hand = ['YX', 'CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH'];
    const s = makeState(cat, { players: [{ deck: deck(), hand, clock: ['CI'] }, { deck: deck() }], start: 'climax' });
    const cx = cardIn(s, 0, 'hand', 'YX');
    // Eight cards left in hand after the climax, so the End Phase stops at the discard with the climax still out.
    const after = act(s, cat, { type: 'PLAY_CLIMAX', player: 0, card: cx });
    expect(after.pending).toEqual({ kind: 'discard', player: 0, count: 1, picked: [] });
    expect(after.players[0].climax.map((c) => c.id)).toEqual([cx]);
    const opp = projectView(after, 1);
    expect(opp.players[0].climax).toEqual([{ id: cx, def: 'YX' }]);
    const played = movesOf(opp.log).find((e) => e.card === cx && e.to.zone === 'climax');
    expect(played).toMatchObject({ from: { player: 0, zone: 'hand' }, to: { player: 0, zone: 'climax' }, reason: 'play' });
  });

  it('[ZONE-32] the climax area holds one card: of two climaxes only the one placed last stays; if both were placed last, both go', () => {
    const s = makeState(cat, { players: [{ deck: deck(), climax: ['YX', 'RX'] }, { deck: deck() }], start: 'main' });
    expect(s.players[0].climax.map((c) => defOfId(s, c.id))).toEqual(['RX']);
    expect(defsIn(s, 0, 'waiting')).toEqual(['YX']);
    expect(s.log.find((e) => e.kind === 'ruleAction')).toMatchObject({ rule: 'extraCards' });

    const base = makeState(cat, { players: [{ deck: deck(), hand: ['RX'], climax: ['YX'] }, { deck: deck() }], start: 'main' });
    const tie = ops.deepClone(base);
    const placedAt = tie.players[0].climax[0]?.placedAt ?? 0;
    const rx = cardIn(tie, 0, 'hand', 'RX');
    ops.moveCard(tie, rx, { player: 0, zone: 'climax' }, 'effect');
    tie.players[0].climax = tie.players[0].climax.map((c) => ({ ...c, placedAt }));
    const after = act(tie, cat, { type: 'PASS', player: 0 });
    expect(after.players[0].climax).toEqual([]);
    expect([...defsIn(after, 0, 'waiting')].sort()).toEqual(['RX', 'YX']);
  });

  it("[ZONE-33] a non-climax card in the climax area goes to its owner's waiting room by rule action; a climax stays", () => {
    const character = makeState(cat, { players: [{ deck: deck(), climax: ['CA'] }, { deck: deck() }], start: 'main' });
    expect(character.players[0].climax).toEqual([]);
    expect(defsIn(character, 0, 'waiting')).toEqual(['CA']);
    expect(character.log.find((e) => e.kind === 'ruleAction')).toMatchObject({ rule: 'illegalCard', players: [0] });

    const event = makeState(cat, { players: [{ deck: deck(), climax: ['YE0'] }, { deck: deck() }], start: 'main' });
    expect(event.players[0].climax).toEqual([]);
    expect(defsIn(event, 0, 'waiting')).toEqual(['YE0']);

    const climax = makeState(cat, { players: [{ deck: deck(), climax: ['YX'] }, { deck: deck() }], start: 'main' });
    expect(climax.players[0].climax.map((c) => defOfId(climax, c.id))).toEqual(['YX']);
    expect(climax.players[0].waiting).toEqual([]);

    // Owned by player 1 but sitting in player 0's climax area: back to player 1.
    const s = makeState(cat, { players: [{ deck: deck() }, { deck: deck(), hand: ['CB'] }], start: 'main' });
    const t = ops.deepClone(s);
    const foreign = cardIn(t, 1, 'hand', 'CB');
    ops.moveCard(t, foreign, { player: 0, zone: 'climax' }, 'effect');
    const after = act(t, cat, { type: 'PASS', player: 0 });
    expect(after.players[0].climax).toEqual([]);
    expect(after.players[1].waiting).toEqual([foreign]);
    expect(after.players[0].waiting).toEqual([]);
  });
});

// --- 3.13 Resolution zone ---------------------------------------------------------------

describe('3.13 resolution zone', () => {
  it("[ZONE-36] a played event goes to its player's resolution zone, then to its owner's waiting room", () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['EV'], stock: ['CA'], waiting: ['CB'] }, { deck: deck() }], start: 'main' });
    const ev = cardIn(s, 0, 'hand', 'EV');
    const after = act(s, cat, { type: 'PLAY_EVENT', player: 0, card: ev });
    const path = movesOf(newEvents(s, after)).filter((e) => e.card === ev);
    expect(path.map((e) => [e.from, e.to])).toEqual([
      [{ player: 0, zone: 'hand' }, { player: 0, zone: 'resolution' }],
      [{ player: 0, zone: 'resolution' }, { player: 0, zone: 'waiting' }],
    ]);
    expect(after.players[0].resolution).toEqual([]);
    expect(defsIn(after, 0, 'waiting')).toEqual(['CB', 'CA', 'EV']);
  });

  it("[ZONE-36][CONC-04] an event played from a hand that is not its owner's still ends in its owner's waiting room", () => {
    const s = makeState(cat, { players: [{ deck: deck(), stock: ['CA'] }, { deck: deck(), hand: ['EV'] }], start: 'main' });
    const ev = cardIn(s, 1, 'hand', 'EV');
    const t = ops.deepClone(s);
    ops.moveCard(t, ev, { player: 0, zone: 'hand' }, 'effect');
    const after = act(t, cat, { type: 'PLAY_EVENT', player: 0, card: ev });
    const path = movesOf(newEvents(t, after)).filter((e) => e.card === ev);
    expect(path.map((e) => e.to)).toEqual([
      { player: 0, zone: 'resolution' },
      { player: 1, zone: 'waiting' },
    ]);
    expect(after.players[1].waiting).toEqual([ev]);
    expect(after.cards[ev]?.owner).toBe(1);
  });

  it('[ZONE-41] resolution-zone cards are visible to both players in order, and the event passing through it is shown to the opponent', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['YE0'], resolution: ['CA', 'CB'] }, { deck: deck() }], start: 'main' });
    for (const viewer of [0, 1] as const) {
      expect(projectView(s, viewer).players[0].resolution.map((c) => c.def)).toEqual(['CA', 'CB']);
    }
    const ev = cardIn(s, 0, 'hand', 'YE0');
    const after = act(s, cat, { type: 'PLAY_EVENT', player: 0, card: ev });
    const seen = movesOf(projectView(after, 1).log).find((e) => e.to.zone === 'resolution');
    expect(seen?.card).toBe(ev);
    // The cards already there were not rearranged.
    expect(defsIn(after, 0, 'resolution')).toEqual(['CA', 'CB']);
  });

  it('[ZONE-41] damage cards stack in the resolution zone in the order revealed, visible to both players and not reorderable', () => {
    // Player 1 takes 2 damage from a direct attack. Their deck holds exactly 2 cards, so the second
    // reveal empties it: the refresh puts a card into a clock of 6, and the level-up prompt arrives
    // while both damage cards are still in the resolution zone.
    const s = makeState(cat, {
      players: [
        { deck: deck(), stage: { 1: 'Y0' } },
        { deck: ['CA', 'CB'], waiting: ['G0', 'G0'], clock: ['CC', 'CD', 'CE', 'CF', 'CG', 'CH'] },
      ],
      start: 'attack',
    });
    const mid = act(s, cat, { type: 'ATTACK', player: 0, slot: 1, attack: 'direct' });
    expect(mid.pending?.kind).toBe('levelUp');
    expect(mid.damage?.cards.length).toBe(2);
    // CB was the top card, so it was revealed first and sits at the bottom of the resolution zone.
    for (const viewer of [0, 1] as const) {
      expect(projectView(mid, viewer).players[1].resolution.map((c) => c.def)).toEqual(['CB', 'CA']);
    }
    expect(attempt(mid, { type: 'REORDER', player: 1, zone: 'resolution', order: [...mid.players[1].resolution].reverse() })).toBe('NOT_REORDERABLE');
    expect(attempt(mid, { type: 'REORDER', player: 0, zone: 'resolution', order: [...mid.players[1].resolution].reverse() })).toBe('NOT_REORDERABLE');
    // After the level up the damage finishes and both cards go to the clock in that same order.
    const done = act(mid, cat, { type: 'LEVEL_UP', player: 1, card: cardIn(mid, 1, 'clock', 'CC') });
    const toClock = movesOf(newEvents(mid, done)).filter((e) => e.reason === 'damageToClock');
    expect(toClock.map((e) => [defOfId(done, e.card), e.from.zone])).toEqual([
      ['CB', 'resolution'],
      ['CA', 'resolution'],
    ]);
    const clock = done.players[1].clock;
    expect(clock.indexOf(cardIn(done, 1, 'clock', 'CA'))).toBe(clock.indexOf(cardIn(done, 1, 'clock', 'CB')) + 1);
    expect(done.players[1].resolution).toEqual([]);
  });
});

// --- 4.2 / 4.3 Owner and master ---------------------------------------------------------

describe('4.2-4.3 owner and master', () => {
  it("[CONC-04] each card's owner is the player whose deck it started in, and that never changes as it moves", () => {
    const states = randomWalk('conc-04', 150);
    const first = states[0] as GameState;
    for (const [id, inst] of Object.entries(first.cards)) expect(inst.owner).toBe(id.startsWith('p0-') ? 0 : 1);
    for (const s of states) {
      for (const [id, inst] of Object.entries(s.cards)) expect(inst.owner).toBe(first.cards[id]?.owner);
    }
    // Cards really did move around during the walk.
    const last = states[states.length - 1] as GameState;
    expect(movesOf(last.log).length).toBeGreaterThan(30);
  });

  it("[CONC-04][CONC-06] a card in the other player's zone keeps its owner, but its master is the player whose zone holds it", () => {
    const s = makeState(cat, { players: [{ deck: deck() }, { deck: deck(), hand: ['CA'] }], start: 'main' });
    const card = cardIn(s, 1, 'hand', 'CA');
    expect(masterOf(s, card)).toBe(1);
    const t = ops.deepClone(s);
    ops.moveCard(t, card, { player: 0, zone: 'hand' }, 'effect');
    expect(t.cards[card]?.owner).toBe(1);
    expect(masterOf(t, card)).toBe(0);

    // The master is the one who may play it, and it goes to the master's stage.
    expect(legalActions(t, cat)).toContainEqual({ type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    expect(legalActions(t, cat, 1)).toEqual([]);
    const after = act(t, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 });
    expect(ops.locate(after, card)).toMatchObject({ player: 0, zone: 'stage', slot: 1 });
    expect(masterOf(after, card)).toBe(0);
    expect(after.cards[card]?.owner).toBe(1);
  });

  it("[CONC-06] the master's level and clock decide whether a borrowed card can be played", () => {
    // R1 is a red level 1 card owned by player 1, whose level and clock are red.
    const spec = (p0Clock: string[]) =>
      makeState(cat, { players: [{ deck: deck(), level: ['CA'], clock: p0Clock }, { deck: deck(), hand: ['R1'], level: ['R0'], clock: ['R0'] }], start: 'main' });
    for (const [p0Clock, playable] of [
      [['CB'], false],
      [['R0'], true],
    ] as const) {
      const t = ops.deepClone(spec([...p0Clock]));
      const card = cardIn(t, 1, 'hand', 'R1');
      ops.moveCard(t, card, { player: 0, zone: 'hand' }, 'effect');
      expect(legalActions(t, cat).some((a) => a.type === 'PLAY_CHARACTER' && a.card === card)).toBe(playable);
    }
  });

  it("[CONC-06] a character is stood by its master's Stand Phase, not its owner's", () => {
    const s = makeState(cat, {
      players: [{ deck: deck() }, { deck: deck(), waiting: ['CC'], stage: { 2: { def: 'CD', orientation: 'rest' } } }],
      start: 'main',
    });
    const borrowed = cardIn(s, 1, 'waiting', 'CC');
    const own = cardIn(s, 1, 'stage', 'CD');
    let t = ops.deepClone(s);
    ops.moveCard(t, borrowed, { player: 0, zone: 'stage', slot: 1 }, 'effect', { orientation: 'rest' });
    const orientation = (st: GameState, id: CardId) => st.players.flatMap((p) => p.stage.flat()).find((c) => c.id === id)?.orientation;

    // Player 0 ends the turn; player 1's Stand Phase stands player 1's own character only.
    t = act(t, cat, { type: 'PASS', player: 0 }, { type: 'PASS', player: 0 });
    expect(t.active).toBe(1);
    expect(t.pending).toEqual({ kind: 'clock', player: 1 });
    expect(orientation(t, own)).toBe('stand');
    expect(orientation(t, borrowed)).toBe('rest');

    // Player 1 ends the turn; player 0 (the master) stands the borrowed card.
    t = act(t, cat, { type: 'CLOCK', player: 1, card: null }, { type: 'PASS', player: 1 }, { type: 'PASS', player: 1 });
    t = act(t, cat, { type: 'PASS', player: 1 }); // CD could attack; player 1 ends the Attack Phase instead
    expect(t.active).toBe(0);
    expect(orientation(t, borrowed)).toBe('stand');
    expect(t.cards[borrowed]?.owner).toBe(1);
  });
});

// --- 4.6 / 4.7 Orientation and drawing -----------------------------------------------------

describe('4.6-4.7 orientation and drawing', () => {
  it('[CONC-14] the Stand Phase switches rested and reversed characters to stand; a standing one does not change again', () => {
    const s = makeState(cat, {
      players: [
        {
          deck: deck(),
          stage: { 1: { def: 'CA', orientation: 'rest' }, 2: { def: 'CB', orientation: 'reverse' }, 3: 'CC', 5: { def: 'CD', orientation: 'rest' } },
        },
        { deck: deck(), stage: { 1: { def: 'CE', orientation: 'rest' }, 2: { def: 'CF', orientation: 'reverse' } } },
      ],
      start: 'stand',
    });
    expect(stageOf(s, 0)).toEqual([
      [1, 'CA', 'stand'],
      [2, 'CB', 'stand'],
      [3, 'CC', 'stand'],
      [5, 'CD', 'stand'],
    ]);
    const changed = s.log.filter((e) => e.kind === 'orientation').map((e) => (e.kind === 'orientation' ? [defOfId(s, e.card), e.orientation] : []));
    expect(changed).toEqual([
      ['CA', 'stand'],
      ['CB', 'stand'],
      ['CD', 'stand'],
    ]);
    // The non-turn player's characters keep their states.
    expect(stageOf(s, 1)).toEqual([
      [1, 'CE', 'rest'],
      [2, 'CF', 'reverse'],
    ]);
  });

  it('[CONC-14] only characters on the stage have an orientation', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['CA'], waiting: ['CB'], clock: ['CC'], stage: { 1: { def: 'CD', orientation: 'reverse' } }, climax: ['YX'] }, { deck: deck() }],
      start: 'main',
    });
    const view = projectView(s, 0).players[0];
    expect(view.stage[0]).toEqual([{ id: cardIn(s, 0, 'stage', 'CD'), def: 'CD', orientation: 'reverse' }]);
    for (const zone of [view.hand ?? [], view.waiting, view.clock, view.climax]) {
      expect(zone.length).toBeGreaterThan(0);
      for (const c of zone) expect(c).not.toHaveProperty('orientation');
    }
    for (const c of s.players[0].climax) expect(c).not.toHaveProperty('orientation');
  });
});
