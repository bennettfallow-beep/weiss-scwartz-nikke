// Whole games through the session layer (M5): two players on one phone, and
// one player against the computer. Every step is one action, the rules
// invariants hold throughout, and the game replays to the same state.

import { describe, expect, it } from 'vitest';

import { checkInvariants, replay, stateHash } from '../../src/engine';
import { gameOverScreen, handoffScreen, screenFor } from '../../src/session';
import { cards, DECKS, playOut, start } from './helpers';

describe('session games', () => {
  it('hot-seat games run to the end, one action per step, with the invariants holding', () => {
    let finished = 0;
    for (let g = 0; g < 12; g++) {
      const decks = [DECKS[g % 3] as string, DECKS[(g + 1) % 3] as string] as const;
      let steps = 0;
      const end = playOut(start({ mode: 'hotseat', decks, seed: `hs-${g}` }), `hs-${g}`, ({ kind, before, after }) => {
        steps++;
        const grew = after.game.actions.length - before.game.actions.length;
        // A handoff changes nothing in the game; every other step is exactly one action.
        expect(grew, `${kind} step`).toBe(kind === 'handoff' ? 0 : 1);
        if (steps % 7 === 0) expect(checkInvariants(after.game.state, cards.catalog)).toEqual([]);
      });
      expect(end.game.state.result, `game ${g}`).not.toBeNull();
      expect(gameOverScreen(end)).not.toBeNull();
      expect(handoffScreen(end)).toBeNull();
      const again = replay(end.game.setup, cards.catalog, end.game.actions);
      expect(again.ok && stateHash(again.state)).toBe(stateHash(end.game.state));
      finished++;
    }
    expect(finished).toBe(12);
  }, 120_000);

  it('games against the computer run to the end; the human always has a board, never a handoff', () => {
    for (let g = 0; g < 8; g++) {
      const decks = [DECKS[g % 3] as string, DECKS[(g + 2) % 3] as string] as const;
      let bot = 0;
      const end = playOut(start({ mode: 'computer', decks, seed: `pc-${g}`, botSeed: `pc-bot-${g}`, humanSeat: (g % 2) as 0 | 1 }), `pc-${g}`, ({ kind, after }) => {
        expect(kind).not.toBe('handoff');
        if (kind === 'bot') bot++;
        if (after.game.state.result === null) expect(screenFor(after)).not.toBeNull();
      });
      expect(end.game.state.result).not.toBeNull();
      expect(bot).toBeGreaterThan(20);
      expect(checkInvariants(end.game.state, cards.catalog)).toEqual([]);
    }
  }, 120_000);

  it('the starter decks load without problems', async () => {
    const { starter } = await import('./helpers');
    expect(starter.ok).toBe(true);
    expect(Object.keys(cards.decks).sort()).toEqual(['blue', 'red', 'yellow']);
    for (const d of Object.values(cards.decks)) expect(d).toHaveLength(50);
    expect(cards.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });
});
