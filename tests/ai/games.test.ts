// Whole games between computer players (M4): every action legal, every
// invariant kept after every action, and every game finished well inside the
// action cap. The win-rate gate itself is `npm run simulate`.
import { describe, expect, it } from 'vitest';

import { decide, heuristicBot, randomBot } from '../../src/ai';
import type { Bot } from '../../src/ai';
import { actor, applyAction, checkInvariants, createGame, seedRng } from '../../src/engine';
import type { GameState, RngState } from '../../src/engine';
import { fuzzCatalog as catalog, fuzzDecks } from '../helpers/fuzz-decks';

const MAX_ACTIONS = 5000;

function playOut(seed: string, decks: [number, number], seats: [Bot, Bot]): { problems: string[]; actions: number; state: GameState } {
  const created = createGame({ seed, decks: [[...(fuzzDecks[decks[0]] ?? [])], [...(fuzzDecks[decks[1]] ?? [])]] }, catalog);
  if (!created.ok) return { problems: ['setup failed'], actions: 0, state: null as never };
  let state = created.state;
  const rngs: [RngState, RngState] = [seedRng(`${seed}-0`), seedRng(`${seed}-1`)];
  const problems: string[] = [];
  let actions = 0;
  for (; !state.result && actions < MAX_ACTIONS && problems.length === 0; actions++) {
    const p = actor(state);
    if (p === null) {
      problems.push(`no player to act at action ${actions}`);
      break;
    }
    const d = decide(state, catalog, p, seats[p], rngs[p]);
    rngs[p] = d.rng;
    if (d.action.type === 'CONCEDE' || d.action.type === 'REORDER') problems.push(`${seats[p].name} played ${d.action.type}`);
    const r = applyAction(state, catalog, d.action);
    if (!r.ok) {
      problems.push(`action ${actions}: ${seats[p].name} played an illegal ${d.action.type}: ${r.error.code}`);
      break;
    }
    state = r.state;
    problems.push(...checkInvariants(state, catalog).map((v) => `action ${actions}: ${v}`));
  }
  if (!state.result && problems.length === 0) problems.push(`no result after ${MAX_ACTIONS} actions`);
  return { problems, actions, state };
}

describe('computer players play whole games', () => {
  const matchups: [string, [Bot, Bot]][] = [
    ['heuristic vs heuristic', [heuristicBot, heuristicBot]],
    ['heuristic vs random', [heuristicBot, randomBot]],
    ['random vs heuristic', [randomBot, heuristicBot]],
  ];
  for (const [label, seats] of matchups) {
    it(`${label}: legal actions only, invariants after every action, every game finished`, () => {
      const games = label === 'heuristic vs heuristic' ? 20 : 10;
      for (let g = 0; g < games; g++) {
        const seed = `ai-${label}-${g}`;
        const run = playOut(seed, [g % 3, Math.floor(g / 3) % 3], seats);
        expect(run.problems, seed).toEqual([]);
        expect(run.state.result?.kind, seed).toBe('win');
      }
    }, 120_000);
  }
});
