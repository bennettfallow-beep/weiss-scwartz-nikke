// A computer player never uses what its player cannot see (M4). Only decide()
// touches the game state; it passes the bot the view and the legal actions.
// Swapping around the hidden cards must not change a single decision.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decide, heuristicBot, randomBot } from '../../src/ai';
import { actionKey, actor, applyAction, createGame, legalActions, projectView, seedRng } from '../../src/engine';
import type { GameState, RngState } from '../../src/engine';
import { fuzzCatalog as catalog, fuzzDecks } from '../helpers/fuzz-decks';
import { hiddenIdsShown, shuffleHidden } from '../helpers/hidden-shuffle';

describe('no peeking', () => {
  it('only src/ai/decide.ts touches the game state; the bots see the view and their legal actions', () => {
    const dir = join(__dirname, '..', '..', 'src', 'ai');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split('\\').join('/'));
    expect(files).toContain('decide.ts');
    // Engine functions a bot may call: none of them can create, run or inspect a game.
    const allowed = new Set(['ENCORE_COST', 'facing', 'HAND_LIMIT', 'isCenter', 'LEVEL_UP_AT', 'LOSING_LEVEL', 'nextInt']);
    for (const file of files.filter((f) => f !== 'decide.ts' && f !== 'index.ts')) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/\bGameState\b|\blegalActions\b|\bprojectView\b|\bapplyAction\b|\bcheckInvariants\b|\bcreateGame\b|\breplay\b/);
      // Every import or re-export from the engine, however it is written: either quote style, the barrel or its index file.
      const engine = /^(\.\.\/)+engine(\/index(\.ts)?)?$/;
      for (const m of text.matchAll(/(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        if (!engine.test(m[4] ?? '') || m[2]) continue;
        const clause = (m[3] ?? '').trim();
        expect(clause.startsWith('{') && clause.endsWith('}'), `${file}: only named imports from the engine (${clause})`).toBe(true);
        const names = clause.slice(1, -1).split(',').map((n) => n.trim()).filter(Boolean);
        for (const n of names) {
          if (n.startsWith('type ')) continue;
          const name = n.split(/\s+as\s+/)[0] ?? n;
          expect(allowed.has(name), `${file} imports ${name} from the engine`).toBe(true);
        }
      }
      expect(text, file).not.toMatch(/require\(|import\(/);
    }
  });

  it('the heuristic bot makes the same decision whatever the cards it cannot see are', () => {
    let compared = 0;
    let swapped = 0;
    let withOpponentHand = 0;
    for (const [g, seed] of ['peek-a', 'peek-b', 'peek-c', 'peek-d'].entries()) {
      const created = createGame({ seed, decks: [[...(fuzzDecks[g % 3] ?? [])], [...(fuzzDecks[(g + 1) % 3] ?? [])]] }, catalog);
      if (!created.ok) throw new Error('setup failed');
      let state: GameState = created.state;
      const rngs: [RngState, RngState] = [seedRng(`${seed}-0`), seedRng(`${seed}-1`)];
      for (let i = 0; !state.result && i < 4000; i++) {
        const p = actor(state);
        if (p === null) throw new Error('no actor');
        const d = decide(state, catalog, p, heuristicBot, rngs[p]);
        if (i % 3 === 0) {
          // Nothing the bot is handed names a card it cannot see.
          expect(hiddenIdsShown(state, p, projectView(state, p, { catalog, logSinceTurn: state.turn }), legalActions(state, catalog)), `${seed} action ${i}`).toEqual([]);
          const other = shuffleHidden(state, p, `${seed}-${i}`);
          compared++;
          if (other.changed > 0) {
            swapped++;
            if (state.players[p === 0 ? 1 : 0].hand.length > 0) withOpponentHand++;
            // The legal actions cannot depend on hidden cards either, or they would leak them to the bot.
            expect(legalActions(other.state, catalog).map(actionKey)).toEqual(legalActions(state, catalog).map(actionKey));
            const again = decide(other.state, catalog, p, heuristicBot, rngs[p]);
            expect(actionKey(again.action), `${seed} action ${i}`).toBe(actionKey(d.action));
            expect(again.rng).toEqual(d.rng);
          }
        }
        rngs[p] = d.rng;
        const r = applyAction(state, catalog, d.action);
        if (!r.ok) throw new Error(r.error.message);
        state = r.state;
      }
    }
    // Something really was swapped, at most of the decisions checked, with the opponent holding cards.
    expect(compared).toBeGreaterThan(200);
    expect(swapped).toBeGreaterThan(compared * 0.9);
    expect(withOpponentHand).toBeGreaterThan(100);
  }, 60_000);

  it('the random bot does too (it reads nothing but its legal actions)', () => {
    const created = createGame({ seed: 'peek-r', decks: [[...(fuzzDecks[0] ?? [])], [...(fuzzDecks[2] ?? [])]] }, catalog);
    if (!created.ok) throw new Error('setup failed');
    let state: GameState = created.state;
    let rng = seedRng('peek-r');
    for (let i = 0; !state.result && i < 4000; i++) {
      const p = actor(state);
      if (p === null) throw new Error('no actor');
      const d = decide(state, catalog, p, randomBot, rng);
      if (i % 5 === 0) expect(actionKey(decide(shuffleHidden(state, p, `r-${i}`).state, catalog, p, randomBot, rng).action)).toBe(actionKey(d.action));
      rng = d.rng;
      const r = applyAction(state, catalog, d.action);
      if (!r.ok) throw new Error(r.error.message);
      state = r.state;
    }
    expect(state.result).not.toBeNull();
  }, 60_000);
});
