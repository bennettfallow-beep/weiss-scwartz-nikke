// The app's screen state (M5): routing, game start, handoff and background
// handling, and stale actions. Pure, so it runs in node.

import { describe, expect, it } from 'vitest';

import { acceptHandoff, botToMove, mulliganChoice, needsHandoff, screenFor, starterCards } from '../../src/session';
import { appReducer, initialState } from '../../src/ui/state/appReducer';
import type { AppAction, AppState } from '../../src/ui/state/appReducer';

const cards = starterCards().source;
const run = (s: AppState, ...actions: AppAction[]) => actions.reduce(appReducer, s);
const hot = (): AppState => run(initialState(cards), { type: 'start', options: { mode: 'hotseat', decks: ['yellow', 'red'], seed: 'reducer-hot' } });

describe('app reducer', () => {
  it('starts at home and navigates without touching a game', () => {
    const s0 = initialState(cards);
    expect(s0.route).toEqual({ name: 'home' });
    const s1 = run(s0, { type: 'navigate', route: { name: 'newGame', mode: 'computer' } }, { type: 'navigate', route: { name: 'help', back: 'home' } });
    expect(s1.route).toEqual({ name: 'help', back: 'home' });
    expect(s1.session).toBeNull();
  });

  it('a new game opens the game route; a bad setup shows a notice and stays put', () => {
    const s = hot();
    expect(s.route).toEqual({ name: 'game' });
    expect(s.session && needsHandoff(s.session)).not.toBeNull();
    expect(s.last).toEqual({ mode: 'hotseat', decks: ['yellow', 'red'] });
    const bad = run(initialState(cards), { type: 'start', options: { mode: 'computer', decks: ['yellow', 'red'], seed: 'x', botSeed: 'x' } });
    expect(bad.session).toBeNull();
    expect(bad.route).toEqual({ name: 'home' });
    expect(bad.notice).toMatch(/must not share/);
  });

  it('going to the background closes panels, clears selections and asks for a handoff again', () => {
    let s = run(hot(), { type: 'handoffDone' });
    expect(s.session && screenFor(s.session)).not.toBeNull();
    s = run(s, { type: 'overlay', overlay: { kind: 'log' } }, { type: 'toggleMulligan', card: 'p0-01' }, { type: 'select', id: 'p0-02' });
    s = run(s, { type: 'background' });
    expect(s.overlay).toBeNull();
    expect(s.selected).toBeNull();
    expect(s.mulligan).toEqual([]);
    expect(s.session && needsHandoff(s.session)).not.toBeNull();
  });

  it('a stale choice gives a notice instead of a crash; a choice clears the selection', () => {
    let s = run(hot(), { type: 'handoffDone' }, { type: 'select', id: 'x' });
    s = run(s, { type: 'choose', key: '{"bogus":true}' });
    expect(s.notice).toBe('That choice is no longer available.');
    expect(s.selected).toBeNull();
    const keep = s.session ? screenFor(s.session)?.prompt : null;
    expect(keep?.kind).toBe('mulligan');
  });

  it('the computer steps only when it is its turn; a stale timer does nothing', () => {
    const s = run(initialState(cards), { type: 'start', options: { mode: 'computer', decks: ['blue', 'red'], seed: 'reducer-pc', botSeed: 'reducer-pc-bot', humanSeat: 1 } });
    if (!s.session) throw new Error('no session');
    let t = s;
    let steps = 0;
    let stale = 0;
    for (let i = 0; i < 200 && steps < 20 && t.session; i++) {
      if (botToMove(t.session)) {
        const next = run(t, { type: 'botStep' });
        expect(next).not.toBe(t);
        t = next;
        steps++;
        continue;
      }
      // Not the computer's turn: a timer firing now changes nothing.
      expect(run(t, { type: 'botStep' })).toBe(t);
      stale++;
      const prompt = screenFor(t.session)?.prompt;
      const key = prompt?.layout === 'subset' ? mulliganChoice(t.session, [])?.key : (prompt?.choices[0]?.key ?? prompt?.groups[0]?.choices[0]?.key);
      if (!key) throw new Error('no choice');
      t = run(t, { type: 'choose', key });
    }
    expect(steps).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(0);
  });

  it('conceding ends the game; quitting returns home with no session', () => {
    let s = run(hot(), { type: 'handoffDone' }, { type: 'overlay', overlay: { kind: 'concede' } }, { type: 'concede' });
    expect(s.session?.game.state.result?.kind).toBe('win');
    expect(s.overlay).toBeNull();
    s = run(s, { type: 'quit' });
    expect(s.session).toBeNull();
    expect(s.route).toEqual({ name: 'home' });
  });

  it('a handoff is accepted only once', () => {
    const s = run(hot(), { type: 'handoffDone' });
    expect(s.session && acceptHandoff(s.session)).toBe(s.session);
  });
});
