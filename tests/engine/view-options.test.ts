// projectView options (M4): current power and soul on stage cards, a log that
// starts at a given turn, and the no-peeking property of the whole view.
import { describe, expect, it } from 'vitest';

import { applyAction, createGame, currentPower, currentSoul, legalActions, projectEvents, projectView, seedRng } from '../../src/engine';
import type { CardCatalog, CardDef, GameState } from '../../src/engine';
import { act, cardIn, makeState, ops } from '../../src/engine/testkit';
import { randomChoice } from '../../src/ai';
import { catalog } from '../helpers/catalog';
import { fuzzCatalog, fuzzDecks } from '../helpers/fuzz-decks';
import { hiddenFrom, hiddenIdsShown, shuffleHidden } from '../helpers/hidden-shuffle';

/** Original synthetic card: +1000 power to your other characters. */
const leader: CardDef = {
  id: 'VW-LEAD',
  name: 'Signal Captain',
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 3000,
  soul: 1,
  abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', other: true } }] }],
};
const cat: CardCatalog = { ...catalog, [leader.id]: leader };

/** States from a seeded random game with the ability decks, every few actions. */
function gameStates(seed: string, every: number): GameState[] {
  const created = createGame({ seed, decks: [[...(fuzzDecks[0] ?? [])], [...(fuzzDecks[1] ?? [])]] }, fuzzCatalog);
  if (!created.ok) throw new Error('setup failed');
  let state = created.state;
  let rng = seedRng(`bot-${seed}`);
  const out: GameState[] = [];
  for (let i = 0; !state.result && i < 3000; i++) {
    if (i % every === 0 || state.resolving?.look) out.push(state);
    const [action, next] = randomChoice(legalActions(state, fuzzCatalog), rng);
    rng = next;
    const r = applyAction(state, fuzzCatalog, action);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
  }
  return out;
}

describe('view options', () => {
  it('with a catalog, each stage card shows its current power and soul; without one, neither', () => {
    const base = makeState(cat, { start: 'main', players: [{ stage: { 1: 'VW-LEAD', 2: 'Y1' }, deck: ['Y0'] }, { stage: { 2: 'R1' }, deck: ['R0'] }] });
    const s = ops.deepClone(base);
    const helped = cardIn(s, 0, 'stage', 'Y1');
    s.effects.push({ card: { card: helped, epoch: s.cards[helped]?.epoch ?? -1 }, stat: 'soul', amount: 2 });
    for (const viewer of [0, 1] as const) {
      const view = projectView(s, viewer, { catalog: cat });
      for (const owner of [0, 1] as const) {
        for (const card of view.players[owner].stage.flat()) {
          expect(card.power).toBe(currentPower(s, cat, card.id));
          expect(card.soul).toBe(currentSoul(s, cat, card.id));
        }
      }
      const y1 = view.players[0].stage[1]?.[0];
      expect([y1?.power, y1?.soul]).toEqual([currentPower(s, cat, helped), currentSoul(s, cat, helped)]);
      expect(y1?.power).toBe((cat.Y1?.power ?? 0) + 1000);
      expect(y1?.soul).toBe((cat.Y1?.soul ?? 0) + 2);
      const plain = projectView(s, viewer).players[0].stage.flat();
      expect(plain.every((c) => !('power' in c) && !('soul' in c))).toBe(true);
    }
  });

  it('logSinceTurn keeps exactly the events from that turn on, redacted as usual', () => {
    const states = gameStates('view-log', 50);
    const s = states[states.length - 1] as GameState;
    expect(s.turn).toBeGreaterThan(3);
    for (const viewer of [0, 1] as const) {
      for (const since of [0, 1, s.turn - 1, s.turn, s.turn + 1]) {
        const expected = projectEvents(
          s.log.filter((e) => e.turn >= since),
          viewer,
        );
        expect(projectView(s, viewer, { logSinceTurn: since }).log).toEqual(expected);
      }
      expect(projectView(s, viewer, {}).log).toEqual(projectView(s, viewer).log);
    }
  });

  it('a player is shown the same view, power and soul and log included, whatever the cards they cannot see are', () => {
    let checked = 0;
    let looks = 0;
    for (const seed of ['view-a', 'view-b', 'view-c']) {
      for (const [k, s] of gameStates(seed, 15).entries()) {
        for (const viewer of [0, 1] as const) {
          // No hidden card's id is shown either: an id gives away which decklist slot the card came from.
          expect(hiddenIdsShown(s, viewer, projectView(s, viewer, { catalog: fuzzCatalog }), viewer === s.pending?.player ? legalActions(s, fuzzCatalog) : []), `${seed} state ${k} viewer ${viewer}`).toEqual([]);
          const { state: swapped, changed } = shuffleHidden(s, viewer, `${seed}-${k}-${viewer}`);
          if (changed === 0) continue;
          expect(projectView(swapped, viewer, { catalog: fuzzCatalog }), `${seed} state ${k} viewer ${viewer}`).toEqual(projectView(s, viewer, { catalog: fuzzCatalog }));
          checked++;
          if (s.resolving?.look?.player === viewer) looks++;
        }
      }
    }
    // Something really was swapped, many times, including while a player looked at deck cards.
    expect(checked).toBeGreaterThan(100);
    expect(looks).toBeGreaterThan(0);
  });

  it('the swap changes what is hidden only: a card the viewer can see keeps its definition', () => {
    const [s] = gameStates('view-d', 1000);
    const state = s as GameState;
    const hidden = new Set(hiddenFrom(state, 0));
    const { state: swapped, changed } = shuffleHidden(state, 0, 'x');
    expect(changed).toBeGreaterThan(0);
    for (const id of Object.keys(state.cards)) if (!hidden.has(id)) expect(swapped.cards[id]?.def).toBe(state.cards[id]?.def);
    // Player 0's own hand is not hidden from player 0.
    for (const id of state.players[0].hand) expect(hidden.has(id)).toBe(false);
    for (const id of state.players[1].hand) expect(hidden.has(id)).toBe(true);
  });

  it('the hidden-id check catches a planted id, and does not count the card whose ability is asking', () => {
    // The ability puts its own card into the waiting room, then draws from an empty deck: the refresh
    // shuffles that card into the deck while its "discard 1" choice is still open.
    const relay: CardDef = {
      id: 'VW-RELAY',
      name: 'Relay Cadet',
      kind: 'character',
      color: 'yellow',
      level: 0,
      cost: 0,
      power: 1000,
      soul: 1,
      abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'sendToWaiting', target: 'this' }, { do: 'draw', count: 1 }, { do: 'discard', count: 1 }] }],
    };
    const c2: CardCatalog = { ...catalog, [relay.id]: relay };
    let s = makeState(c2, { start: 'main', players: [{ hand: ['VW-RELAY', 'Y1', 'Y1'], deck: ['Y0'], waiting: Array<string>(4).fill('Y1') }, { deck: ['R0', 'R0'], hand: ['R0'] }] });
    const id = cardIn(s, 0, 'hand', 'VW-RELAY');
    s = act(s, c2, { type: 'PLAY_CHARACTER', player: 0, slot: 1, card: id });
    for (let i = 0; i < 5 && s.pending?.kind !== 'pick'; i++) s = act(s, c2, legalActions(s, c2)[0] as never);
    expect(s.pending).toMatchObject({ kind: 'pick', card: id });
    expect(s.players[0].deck).toContain(id);
    const view = projectView(s, 0, { catalog: c2 });
    expect(hiddenIdsShown(s, 0, view, legalActions(s, c2))).toEqual([]);
    // A real leak, the opponent's hand card named in a zone, is caught.
    const theirs = s.players[1].hand[0] as string;
    const leaky = { ...view, players: [{ ...view.players[0], waiting: [...view.players[0].waiting, { id: theirs, def: '?' }] }, view.players[1]] } as typeof view;
    expect(hiddenIdsShown(s, 0, leaky)).toEqual([theirs]);
  });
});
