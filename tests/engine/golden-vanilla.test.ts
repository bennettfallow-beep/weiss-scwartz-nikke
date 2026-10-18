// Regression net for M3 and later: seeded random games with the frozen M2 decks
// (no card abilities) must produce exactly the event logs M2 produced. Adding
// abilities to the engine may add state, but must not change a vanilla game.
//
//   UPDATE_GOLDEN=1 npx vitest run --project unit tests/engine/golden-vanilla.test.ts
// rewrites the fixture. Only do that for a deliberate, explained rules change.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyAction, createGame, hashSeed, legalActions, nextInt, seedRng } from '../../src/engine';
import type { Action, GameState, RngState } from '../../src/engine';
import { vanillaCatalog as catalog, vanillaDecks } from '../helpers/vanilla-decks';

const FIXTURE = join(__dirname, '../fixtures/golden-vanilla.json');
const GAMES_PER_PAIRING = 10;
const MAX_ACTIONS = 5000;

interface Golden {
  seed: string;
  pairing: [number, number];
  actions: number;
  turns: number;
  result: string;
  logHash: string;
  /** Decisions made on the end-of-turn hand-limit discard prompt. A game with none is untouched by changes to that prompt. */
  discardPrompts: number;
}

/** JSON with sorted keys, so the hash does not depend on property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hash = (text: string) =>
  hashSeed(text)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');

/** The same bot as the fuzz harness: a uniform action type, then a uniform action of that type. */
function pick(legal: readonly Action[], rng: RngState): [Action, RngState] {
  const types = [...new Set(legal.map((a) => a.type))];
  const [ti, r1] = nextInt(rng, types.length);
  const ofType = legal.filter((a) => a.type === types[ti]);
  const [ai, r2] = nextInt(r1, ofType.length);
  return [ofType[ai] as Action, r2];
}

function play(seed: string, pairing: [number, number]): Golden {
  const decks: [string[], string[]] = [[...(vanillaDecks[pairing[0]] ?? [])], [...(vanillaDecks[pairing[1]] ?? [])]];
  const created = createGame({ seed, decks }, catalog);
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.errors)}`);
  let state: GameState = created.state;
  let rng = seedRng(`golden-${seed}`);
  let actions = 0;
  let discardPrompts = 0;
  while (!state.result && actions < MAX_ACTIONS) {
    if (state.pending?.kind === 'discard') discardPrompts++;
    const [action, next] = pick(legalActions(state, catalog), rng);
    rng = next;
    const r = applyAction(state, catalog, action);
    if (!r.ok) throw new Error(`${seed}: legal ${action.type} rejected: ${r.error.code}`);
    state = r.state;
    actions++;
  }
  const result = state.result === null ? 'none' : state.result.kind === 'draw' ? 'draw' : `p${state.result.winner}:${state.result.reason}`;
  return { seed, pairing, actions, turns: state.turn, result, logHash: hash(canonical(state.log)), discardPrompts };
}

function playAll(): Golden[] {
  const out: Golden[] = [];
  for (let a = 0; a < vanillaDecks.length; a++) {
    for (let b = 0; b < vanillaDecks.length; b++) {
      for (let g = 0; g < GAMES_PER_PAIRING; g++) out.push(play(`golden-${a}${b}-${g}`, [a, b]));
    }
  }
  return out;
}

describe('vanilla games are unchanged (golden logs from M2)', () => {
  it('replays every recorded game to the same event log', () => {
    const games = playAll();
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(FIXTURE, `${JSON.stringify(games, null, 1)}\n`);
    const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden[];
    expect(games.length).toBe(recorded.length);
    const differ = games.filter((g, i) => JSON.stringify(g) !== JSON.stringify(recorded[i])).map((g) => g.seed);
    expect(differ).toEqual([]);
  }, 300_000);
});
