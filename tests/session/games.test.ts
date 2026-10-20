// Whole games through the session layer (M5): two players on one phone, and
// one player against the computer. Every step is one action, the rules
// invariants hold throughout, and the game replays to the same state.

import { describe, expect, it } from 'vitest';

import { checkInvariants, replay, stateHash } from '../../src/engine';
import { gameOverScreen, handoffScreen, logFor, screenFor } from '../../src/session';
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

describe('what the player is told', () => {
  it('"What just happened" includes the results of your own step, such as your trigger check', () => {
    let found = 0;
    for (let g = 0; g < 6 && found < 3; g++) {
      playOut(start({ mode: 'computer', decks: ['yellow', 'red'], seed: `recent-${g}`, botSeed: `recent-bot-${g}` }), `recent-${g}`, ({ kind, before, after }) => {
        if (kind !== 'human') return;
        const a = after.game.actions.at(-1);
        const screen = screenFor(after);
        const checked = after.game.state.log.slice(before.game.state.log.length).some((e) => e.kind === 'triggerCheck');
        if (a?.type !== 'ATTACK' || !checked || !screen?.prompt) return;
        expect(screen.recent.some((l) => l.text.startsWith('Trigger check:'))).toBe(true);
        found++;
      });
    }
    expect(found).toBeGreaterThan(0);
  }, 60_000);

  it('log lines start with a capital, and a clock or mulligan is not counted as extra draws', () => {
    playOut(start({ mode: 'hotseat', decks: ['blue', 'red'], seed: 'log-words' }), 'log-words', ({ kind, after }) => {
      if (kind !== 'human') return;
      for (const line of logFor(after, 30)) {
        expect(line.text.charAt(0), line.text).toBe(line.text.charAt(0).toUpperCase());
        expect(line.text).not.toMatch(/and drew \d/);
      }
    });
  }, 60_000);

  it('the player looking at deck cards is shown every one of them', () => {
    let seen = 0;
    for (let g = 0; g < 8 && seen < 10; g++) {
      playOut(start({ mode: 'hotseat', decks: [DECKS[g % 3] as string, DECKS[(g + 1) % 3] as string], seed: `look-${g}` }), `look-${g}`, ({ after }) => {
        const screen = screenFor(after);
        const look = screen?.look;
        if (!screen || !look || look.count === 0 || after.game.state.resolving?.look?.player !== screen.viewer) return;
        expect(look.cards?.length).toBe(look.count);
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(0);
  }, 60_000);
});
