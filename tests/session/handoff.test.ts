// Hot-seat handoff (M5): the board is shown only to the player whose decision
// it is, after they have taken the phone. Every seat change needs a handoff,
// including the defender's counter step, which is never skipped.

import { describe, expect, it } from 'vitest';

import { acceptHandoff, choose, concede, cover, handoffScreen, needsHandoff, screenFor, toAct, undo, viewer } from '../../src/session';
import { DECKS, playOut, promptKeys, start } from './helpers';

describe('hot-seat handoff', () => {
  it('a new game starts with a handoff to the starting player, and nothing is shown before it', () => {
    const s = start({ mode: 'hotseat', decks: ['yellow', 'red'], seed: 'handoff-a' });
    const first = toAct(s);
    expect(first).not.toBeNull();
    expect(needsHandoff(s)).toBe(first);
    expect(viewer(s)).toBeNull();
    expect(screenFor(s)).toBeNull();
    const h = handoffScreen(s);
    expect(h?.to).toBe(first);
    expect(h?.first).toMatch(/goes first \(chosen at random\)/);
    expect(h?.context).toBe('Setup · Mulligan');
    for (const r of [choose(s, 'x'), concede(s), undo(s)]) expect(r.ok ? 'ok' : r.error.code).not.toBe('ok');
    expect((choose(s, 'x') as { ok: false; error: { code: string } }).error.code).toBe('HANDOFF_PENDING');
    const taken = acceptHandoff(s);
    expect(needsHandoff(taken)).toBeNull();
    expect(viewer(taken)).toBe(first);
    expect(screenFor(taken)?.prompt?.kind).toBe('mulligan');
  });

  it('every change of decision-maker needs a handoff, every counter step included', () => {
    let counterHandoffs = 0;
    let handoffs = 0;
    let checked = 0;
    for (let g = 0; g < 6; g++) {
      playOut(start({ mode: 'hotseat', decks: [DECKS[g % 3] as string, DECKS[(g + 1) % 3] as string], seed: `handoff-${g}` }), `handoff-${g}`, ({ kind, before, after }) => {
        if (kind === 'handoff') {
          handoffs++;
          // Only the handoff screen exists until the phone is taken.
          expect(screenFor(before)).toBeNull();
          expect(handoffScreen(before)?.to).toBe(toAct(before));
          return;
        }
        const next = toAct(after);
        if (next === null) return;
        checked++;
        if (next === after.holder) expect(needsHandoff(after)).toBeNull();
        else {
          expect(needsHandoff(after)).toBe(next);
          expect(screenFor(after)).toBeNull();
          const st = after.game.state;
          if (st.pending?.kind === 'play' && st.pending.window === 'counter') counterHandoffs++;
        }
      });
    }
    expect(checked).toBeGreaterThan(500);
    expect(handoffs).toBeGreaterThan(50);
    // The counter step changes the decision-maker every time, so it always needs a handoff.
    expect(counterHandoffs).toBeGreaterThan(10);
  }, 120_000);

  it('the counter step is offered even with nothing to play, so its prompt gives nothing away', () => {
    let seen = 0;
    for (let g = 0; g < 4 && seen < 5; g++) {
      playOut(start({ mode: 'hotseat', decks: ['red', 'blue'], seed: `counter-${g}` }), `counter-${g}`, ({ after }) => {
        const st = after.game.state;
        if (st.pending?.kind !== 'play' || st.pending.window !== 'counter' || needsHandoff(after) === null) return;
        const taken = acceptHandoff(after);
        const p = screenFor(taken)?.prompt;
        expect(p?.title).toBe('Counter step');
        expect(promptKeys(p ?? { choices: [], groups: [] } as never).length).toBeGreaterThanOrEqual(1);
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(0);
  }, 60_000);

  it('covering the board (the app went to the background) asks for a handoff again', () => {
    const s = acceptHandoff(start({ mode: 'hotseat', decks: ['yellow', 'blue'], seed: 'cover-a' }));
    expect(screenFor(s)).not.toBeNull();
    const covered = cover(s);
    expect(screenFor(covered)).toBeNull();
    expect(needsHandoff(covered)).toBe(toAct(s));
    expect(screenFor(acceptHandoff(covered))).toEqual(screenFor(s));
  });

  it('against the computer there is never a handoff, and covering changes nothing', () => {
    const s = start({ mode: 'computer', decks: ['yellow', 'red'], seed: 'pc-handoff', botSeed: 'pc-handoff-bot' });
    expect(needsHandoff(s)).toBeNull();
    expect(cover(s)).toBe(s);
    expect(handoffScreen(s)).toBeNull();
    expect(viewer(s)).toBe(0);
  });
});
