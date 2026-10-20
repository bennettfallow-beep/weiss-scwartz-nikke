// The computer player in a session (M5): it needs its own seed, separate from
// the game's, and makes exactly one decision per step.

import { describe, expect, it } from 'vitest';

import { decide, heuristicBot } from '../../src/ai';
import { actionKey, seedRng, stateHash } from '../../src/engine';
import { botToMove, choose, newGame, screenFor, stepBot, toAct } from '../../src/session';
import { cards, randomKey, start } from './helpers';

describe('computer player in a session', () => {
  it('rejects bad setups with a code', () => {
    const code = (r: ReturnType<typeof newGame>) => (r.ok ? 'ok' : r.error.code);
    expect(code(newGame(cards, { mode: 'computer', decks: ['yellow', 'red'], seed: 'a' }))).toBe('BOT_SEED_REQUIRED');
    expect(code(newGame(cards, { mode: 'computer', decks: ['yellow', 'red'], seed: 'a', botSeed: 'a' }))).toBe('SAME_SEED');
    expect(code(newGame(cards, { mode: 'computer', decks: ['yellow', 'red'], seed: 'a', botSeed: '' }))).toBe('BOT_SEED_REQUIRED');
    expect(code(newGame(cards, { mode: 'hotseat', decks: ['yellow', 'red'], seed: '' }))).toBe('BAD_SEED');
    expect(code(newGame(cards, { mode: 'hotseat', decks: ['yellow', 'red'], seed: 'x'.repeat(201) }))).toBe('BAD_SEED');
    expect(code(newGame(cards, { mode: 'hotseat', decks: ['yellow', 'green'], seed: 'a' }))).toBe('BAD_DECK');
    expect(code(newGame(cards, { mode: 'hotseat', decks: ['toString', 'red'], seed: 'a' }))).toBe('BAD_DECK');
  });

  it('the computer’s seed does not change the deal', () => {
    const a = start({ mode: 'computer', decks: ['yellow', 'red'], seed: 'deal', botSeed: 'bot-1' });
    const b = start({ mode: 'computer', decks: ['yellow', 'red'], seed: 'deal', botSeed: 'bot-2' });
    expect(stateHash(a.game.state)).toBe(stateHash(b.game.state));
  });

  it('each step is one decision of the heuristic player with the session’s own random source', () => {
    let s = start({ mode: 'computer', decks: ['blue', 'yellow'], seed: 'steps', botSeed: 'steps-bot', humanSeat: 1 });
    let rng = seedRng('steps-human');
    let botSteps = 0;
    for (let i = 0; i < 400 && s.game.state.result === null; i++) {
      if (botToMove(s)) {
        const p = toAct(s) as 0 | 1;
        expect(p).toBe(0);
        const expected = decide(s.game.state, cards.catalog, p, heuristicBot, s.botRng ?? seedRng('x'));
        // The human cannot act for the computer.
        const human = choose(s, actionKey(expected.action));
        expect(human.ok ? 'ok' : human.error.code).toBe('NOT_YOUR_DECISION');
        const r = stepBot(s);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.session.game.actions.at(-1)).toEqual(expected.action);
        expect(r.session.botRng).toEqual(expected.rng);
        s = r.session;
        botSteps++;
        continue;
      }
      const none = stepBot(s);
      expect(none.ok ? 'ok' : none.error.code).toBe('NO_BOT_TURN');
      const screen = screenFor(s);
      if (!screen) throw new Error('no screen');
      const [key, next] = randomKey(s, screen, rng);
      rng = next;
      const r = choose(s, key);
      if (!r.ok) throw new Error(r.error.code);
      s = r.session;
    }
    expect(botSteps).toBeGreaterThan(30);
  });

  it('while the computer decides, the human sees a waiting line and no prompt', () => {
    let s = start({ mode: 'computer', decks: ['red', 'blue'], seed: 'wait', botSeed: 'wait-bot', humanSeat: 1 });
    let rng = seedRng('wait-human');
    let waits = 0;
    for (let i = 0; i < 300 && s.game.state.result === null; i++) {
      const screen = screenFor(s);
      if (!screen) throw new Error('no screen');
      if (botToMove(s)) {
        expect(screen.prompt).toBeNull();
        expect(screen.waiting).toMatch(/^Computer /);
        waits++;
        const r = stepBot(s);
        if (!r.ok) throw new Error(r.error.code);
        s = r.session;
      } else {
        expect(screen.waiting).toBeNull();
        const [key, next] = randomKey(s, screen, rng);
        rng = next;
        const r = choose(s, key);
        if (!r.ok) throw new Error(r.error.code);
        s = r.session;
      }
    }
    expect(waits).toBeGreaterThan(10);
  });
});
