// The heuristic computer player's choices on crafted situations, one kind of
// decision at a time (M4). Original synthetic cards only.
import { describe, expect, it } from 'vitest';

import { decide, heuristicBot } from '../../src/ai';
import { seedRng } from '../../src/engine';
import type { Action, CardCatalog, CardDef, GameState, PlayerId } from '../../src/engine';
import { act, cardIn, makeState } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

const extra: CardDef[] = [
  { id: 'AI-BK', name: 'Shield Runner', kind: 'character', color: 'red', level: 0, cost: 0, power: 1000, soul: 1, counter: true, backup: { power: 3000, level: 0, stock: 1 } },
  { id: 'AI-DEF', name: 'Line Holder', kind: 'character', color: 'red', level: 0, cost: 0, power: 5000, soul: 1 },
  { id: 'AI-WEAK', name: 'Spare Hand', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 500, soul: 1 },
  {
    id: 'AI-PUMP',
    name: 'Rally Signal',
    kind: 'event',
    color: 'yellow',
    level: 0,
    cost: 0,
    effect: [
      { do: 'choose', as: 'x', count: 1, what: { side: 'you' } },
      { do: 'power', amount: 2000, target: { ref: 'x' } },
    ],
  },
  {
    id: 'AI-BOUNCE',
    name: 'Recall Order',
    kind: 'event',
    color: 'yellow',
    level: 0,
    cost: 0,
    effect: [
      { do: 'choose', as: 'y', count: 1, what: { side: 'opponent' } },
      { do: 'returnToHand', target: { ref: 'y' } },
    ],
  },
];
const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

const choose = (s: GameState, player: PlayerId = 0): Action => decide(s, cat, player, heuristicBot, seedRng('decisions')).action;
const defsOf = (s: GameState, ids: readonly string[]) => ids.map((id) => s.cards[id]?.def).sort();

describe('heuristic bot: setup and turn start', () => {
  it('mulligan: sends back climaxes and cards of level 2 or more, keeps low characters', () => {
    const s = makeState(cat, { start: 'mulligan', players: [{ hand: ['YX', 'Y2', 'Y0', 'Y1', 'R1'], deck: Array<string>(10).fill('Y0') }, { hand: ['R0'], deck: Array<string>(10).fill('R0') }] });
    const a = choose(s);
    expect(a.type).toBe('MULLIGAN');
    if (a.type === 'MULLIGAN') expect(defsOf(s, a.discard)).toEqual(['Y2', 'YX']);
  });

  it('clock: clocks the least useful card (a second climax) early, and never at level 3', () => {
    const early = makeState(cat, { start: 'clock', players: [{ hand: ['Y1', 'YX', 'YX', 'Y2'], deck: ['Y0', 'Y0', 'Y0'] }, { deck: ['R0'] }] });
    const a = choose(early);
    expect(a.type === 'CLOCK' && a.card !== null && early.cards[a.card]?.def).toBe('YX');
    const late = makeState(cat, { start: 'clock', players: [{ hand: ['Y1', 'YX'], level: ['Y0', 'Y0', 'Y0'], deck: ['Y0', 'Y0', 'Y0'] }, { deck: ['R0'] }] });
    expect(choose(late)).toEqual({ type: 'CLOCK', player: 0, card: null });
  });

  it('level up: puts into the level zone a card of the color the hand needs', () => {
    const s = makeState(cat, { start: 'main', players: [{ clock: ['Y0', 'Y0', 'R0', 'Y0', 'Y0', 'Y0', 'Y0'], hand: ['R1', 'R1', 'Y1'], deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(s.pending?.kind).toBe('levelUp');
    const a = choose(s);
    expect(a.type === 'LEVEL_UP' && s.cards[a.card]?.def).toBe('R0');
  });

  it('hand limit: discards one card at a time, the spare climaxes first, keeping one', () => {
    let s = makeState(cat, { start: 'end', players: [{ hand: [...Array<string>(6).fill('Y1'), 'YX', 'YX', 'YX'], deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(s.pending).toMatchObject({ kind: 'discard', count: 2 });
    for (let k = 0; k < 2; k++) {
      const a = choose(s);
      expect(a.type === 'CHOOSE_CARD' && s.cards[a.card]?.def).toBe('YX');
      s = act(s, cat, a);
    }
    expect(defsOf(s, s.players[0].hand)).toEqual([...Array<string>(6).fill('Y1'), 'YX']);
  });
});

describe('heuristic bot: main and climax phases', () => {
  it('plays an affordable character into an empty center position', () => {
    const s = makeState(cat, { start: 'main', players: [{ hand: ['Y1'], stock: ['Y0'], level: ['Y0'], clock: ['Y0'], deck: ['Y0'] }, { deck: ['R0'] }] });
    const a = choose(s);
    expect(a.type).toBe('PLAY_CHARACTER');
    if (a.type === 'PLAY_CHARACTER') expect(a.slot).toBeLessThanOrEqual(3);
  });

  it('does not throw away a stronger character to make room, and then ends the phase', () => {
    const s = makeState(cat, { start: 'main', players: [{ hand: ['Y0'], stage: { 1: 'Y2', 2: 'Y2', 3: 'Y2', 4: 'Y2', 5: 'Y2' }, deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(choose(s)).toEqual({ type: 'PASS', player: 0 });
  });

  it('moves a stronger back-stage character to the center, and only while that helps', () => {
    const s = makeState(cat, { start: 'main', players: [{ stage: { 1: 'Y0', 4: 'Y2' }, deck: ['Y0'] }, { deck: ['R0'] }] });
    const a = choose(s);
    expect(a.type).toBe('SWAP');
    const after = act(s, cat, a);
    expect(choose(after)).toEqual({ type: 'PASS', player: 0 });
  });

  it('plays a climax with two attackers ready, not with none', () => {
    const ready = makeState(cat, { start: 'climax', players: [{ hand: ['YX'], clock: ['Y0'], stage: { 1: 'Y1', 2: 'Y1' }, deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(choose(ready).type).toBe('PLAY_CLIMAX');
    const empty = makeState(cat, { start: 'climax', players: [{ hand: ['YX'], clock: ['Y0'], deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(choose(empty)).toEqual({ type: 'PASS', player: 0 });
  });

  it('target picks: a power boost goes to its own strongest character, a bounce to the opponent strongest; the prompt names the choice', () => {
    const pump = makeState(cat, { start: 'main', players: [{ hand: ['AI-PUMP'], stage: { 1: 'Y0', 2: 'Y2' }, deck: ['Y0'] }, { deck: ['R0'], stage: { 2: 'R3' } }] });
    const picking = act(pump, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(pump, 0, 'hand', 'AI-PUMP') });
    expect(picking.pending).toMatchObject({ kind: 'pick', purpose: 'target', as: 'x' });
    const a = choose(picking);
    expect(a.type === 'CHOOSE_CARD' && picking.cards[a.card]?.def).toBe('Y2');

    const bounce = makeState(cat, { start: 'main', players: [{ hand: ['AI-BOUNCE'], stage: { 1: 'Y0' }, deck: ['Y0'] }, { deck: ['R0'], stage: { 1: 'R0', 2: 'R3' } }] });
    const picking2 = act(bounce, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(bounce, 0, 'hand', 'AI-BOUNCE') });
    const b = choose(picking2);
    expect(b.type === 'CHOOSE_CARD' && picking2.cards[b.card]?.def).toBe('R3');
  });
});

describe('heuristic bot: attacks and defence', () => {
  const attackFrom = (mine: string, theirs: string | null) =>
    makeState(cat, { start: 'attack', players: [{ deck: ['Y0', 'Y0', 'Y0'], stage: { 2: mine } }, { deck: ['R0', 'R0', 'R0'], ...(theirs ? { stage: { 2: theirs } } : {}) }] });

  it('attacks directly when nothing faces the attacker', () => {
    expect(choose(attackFrom('Y1', null))).toEqual({ type: 'ATTACK', player: 0, slot: 2, attack: 'direct' });
  });

  it('attacks frontally when it wins the battle, from the side when it would lose', () => {
    expect(choose(attackFrom('Y2', 'R1'))).toEqual({ type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' });
    expect(choose(attackFrom('Y0', 'R0'))).toEqual({ type: 'ATTACK', player: 0, slot: 2, attack: 'side' });
  });

  it('counter step: uses Backup when it saves the defender, passes when the defender already wins', () => {
    const counterWith = (defender: string) => {
      const s = makeState(cat, { start: 'attack', players: [{ deck: ['Y0', 'Y0', 'Y0'], stage: { 2: 'Y2' } }, { deck: ['R0', 'R0', 'R0'], stage: { 2: defender }, hand: ['AI-BK'], stock: ['R0'] }] });
      return act(s, cat, { type: 'ATTACK', player: 0, slot: 2, attack: 'frontal' });
    };
    const losing = counterWith('AI-DEF'); // 5000 against 7000; Backup +3000 makes 8000
    expect(losing.pending).toMatchObject({ kind: 'play', window: 'counter', player: 1 });
    expect(choose(losing, 1)).toEqual({ type: 'BACKUP', player: 1, card: cardIn(losing, 1, 'hand', 'AI-BK') });
    const winning = counterWith('R3'); // 10500 against 7000
    expect(choose(winning, 1)).toEqual({ type: 'PASS', player: 1 });
  });

  it('Encore: pays for a valuable character, not for a weak one', () => {
    const encoreFor = (def: string) => {
      const s = makeState(cat, { start: 'main', players: [{ deck: ['Y0', 'Y0'], hand: ['Y0'], stock: ['Y0', 'Y0', 'Y0'], stage: { 1: def } }, { deck: ['R0'] }] });
      return act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'Y0'), slot: 1 });
    };
    const strong = encoreFor('Y2');
    expect(strong.pending).toMatchObject({ kind: 'encore' });
    expect(choose(strong)).toEqual({ type: 'ACCEPT', player: 0 });
    expect(choose(encoreFor('AI-WEAK'))).toEqual({ type: 'PASS', player: 0 });
  });
});

describe('decide()', () => {
  it('refuses to move for a player the game is not waiting on', () => {
    const s = makeState(cat, { start: 'main', players: [{ deck: ['Y0'] }, { deck: ['R0'] }] });
    expect(() => decide(s, cat, 1, heuristicBot, seedRng('x'))).toThrow(/no decision/);
  });

  it('rejects a bot that answers with an action that is not legal', () => {
    const s = makeState(cat, { start: 'main', players: [{ deck: ['Y0'] }, { deck: ['R0'] }] });
    const cheat = { name: 'cheat', choose: (_v: unknown, _l: unknown, _c: unknown, rng: never) => ({ action: { type: 'CONCEDE', player: 1 } as Action, rng }) };
    expect(() => decide(s, cat, 0, cheat, seedRng('x'))).toThrow(/not legal/);
  });
});
