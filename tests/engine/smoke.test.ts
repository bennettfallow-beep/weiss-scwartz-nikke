// M1 smoke: random legal play from many seeds, checking invariants after every
// action and that replaying the same actions reproduces the same state.
// (The full fuzz harness with combat arrives in M2.)
import { describe, expect, it } from 'vitest';

import { applyAction, checkInvariants, createGame, legalActions, nextInt, replay, seedRng, stateHash } from '../../src/engine';
import type { Action, GameState } from '../../src/engine';
import { catalog, legalDeck } from '../helpers/catalog';

// 150 games in the everyday run; the milestone gate runs SMOKE_GAMES=500.
const GAMES = Number(process.env.SMOKE_GAMES ?? 150);
const MAX_ACTIONS = 400;

function playRandom(seed: string): { state: GameState; actions: Action[]; violations: string[] } {
  const created = createGame({ seed, decks: [legalDeck('yellow'), legalDeck('red')] }, catalog);
  if (!created.ok) throw new Error(JSON.stringify(created.errors));
  let state = created.state;
  let rng = seedRng(`bot-${seed}`);
  const actions: Action[] = [];
  const violations = checkInvariants(state, catalog);
  for (let i = 0; i < MAX_ACTIONS && !state.result && violations.length === 0; i++) {
    const legal = legalActions(state, catalog);
    if (legal.length === 0) {
      violations.push(`no legal action at step ${i} (pending ${state.pending?.kind ?? 'none'})`);
      break;
    }
    const [pick, next] = nextInt(rng, legal.length);
    rng = next;
    const action = legal[pick] as Action;
    const r = applyAction(state, catalog, action);
    if (!r.ok) {
      violations.push(`legal action rejected at step ${i}: ${r.error.code}`);
      break;
    }
    actions.push(action);
    state = r.state;
    violations.push(...checkInvariants(state, catalog).map((v) => `step ${i}: ${v}`));
  }
  return { state, actions, violations };
}

describe('engine smoke (random legal play)', () => {
  it(`keeps every invariant across ${GAMES} seeded games`, () => {
    const failures: string[] = [];
    let turns = 0;
    for (let g = 0; g < GAMES; g++) {
      const { state, violations } = playRandom(`smoke-${g}`);
      turns += state.turn;
      if (violations.length > 0) failures.push(`seed smoke-${g}: ${violations.slice(0, 3).join('; ')}`);
    }
    expect(failures).toEqual([]);
    expect(turns).toBeGreaterThan(GAMES * 3); // games actually progress through turns
  }, 600_000);

  it('replays to an identical state hash', () => {
    for (let g = 0; g < 25; g++) {
      const { state, actions } = playRandom(`replay-${g}`);
      const again = replay({ seed: `replay-${g}`, decks: [legalDeck('yellow'), legalDeck('red')] }, catalog, actions);
      expect(again.ok).toBe(true);
      if (again.ok) expect(stateHash(again.state)).toBe(stateHash(state));
    }
  }, 120_000);

  it('never mutates the state it is given', () => {
    const created = createGame({ seed: 'freeze', decks: [legalDeck('yellow'), legalDeck('red')] }, catalog);
    if (!created.ok) throw new Error('setup failed');
    let state = created.state;
    for (let i = 0; i < 60 && !state.result; i++) {
      const frozen = deepFreeze(state);
      const action = legalActions(frozen, catalog)[0] as Action;
      const r = applyAction(frozen, catalog, action);
      expect(r.ok).toBe(true);
      if (r.ok) state = r.state;
    }
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
