// Privacy of everything the session hands the app (M5). A player's screen,
// prompt and log never name a card they cannot see or have never seen, never
// carry the seed or the random generator state, and do not change when the
// cards hidden from them are swapped around.

import { describe, expect, it } from 'vitest';

import { canSee, HIDDEN, projectEvents } from '../../src/engine';
import type { CardId, GameState, PlayerId } from '../../src/engine';
import { buildScreen, handoffScreen, logFor } from '../../src/session';
import type { Session } from '../../src/session';
import { hiddenFrom, shuffleHidden } from '../helpers/hidden-shuffle';
import { cards, DECKS, playOut, start } from './helpers';

const NAMES = [...new Set(Object.values(cards.catalog).map((d) => d.name))];

function screenOf(s: Session, state: GameState, v: PlayerId) {
  return buildScreen(state, v, { cards: s.cards, seats: s.seats, mode: s.mode, memory: s.game.memory[v], mark: s.game.marks[v], canUndo: false });
}

/** Ids a player may legitimately know: visible now, or named in an event redacted for them. */
function knowable(state: GameState, events: GameState['log'], v: PlayerId): Set<CardId> {
  const out = new Set<CardId>(Object.keys(state.cards).filter((id) => !hiddenFrom(state, v).includes(id)));
  const walk = (x: unknown): void => {
    if (typeof x === 'string' && x !== HIDDEN && Object.prototype.hasOwnProperty.call(state.cards, x)) out.add(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x !== null && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(projectEvents(events, v));
  return out;
}

describe('session privacy', () => {
  it('screens show no hidden card id, no seed and no generator state, and ignore swapped hidden cards', () => {
    let checked = 0;
    let swapped = 0;
    for (let g = 0; g < 6; g++) {
      const mode = g % 2 === 0 ? 'hotseat' : 'computer';
      const session = start(
        mode === 'hotseat'
          ? { mode, decks: [DECKS[g % 3] as string, DECKS[(g + 1) % 3] as string], seed: `priv-${g}` }
          : { mode, decks: [DECKS[g % 3] as string, DECKS[(g + 1) % 3] as string], seed: `priv-${g}`, botSeed: `priv-bot-${g}` },
      );
      let step = 0;
      playOut(session, `priv-${g}`, ({ after }) => {
        if (++step % 4 !== 0) return;
        const state = after.game.state;
        for (const v of [0, 1] as const) {
          const screen = screenOf(after, state, v);
          const text = JSON.stringify(screen);
          const hidden = hiddenFrom(state, v);
          for (const id of hidden) expect(text.includes(`"${id}"`), `viewer ${v} sees hidden ${id}`).toBe(false);
          expect(text).not.toContain(state.seed);
          expect(text).not.toMatch(/"(seed|rng)"/);
          const other = shuffleHidden(state, v, `priv-${g}-${step}-${v}`);
          if (other.changed > 0) {
            swapped++;
            expect(screenOf(after, other.state, v)).toEqual(screen);
          }
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(400);
    expect(swapped).toBeGreaterThan(300);
  }, 180_000);

  it('a player learns only cards they could see, or that a public event named', () => {
    let learned = 0;
    for (let g = 0; g < 4; g++) {
      playOut(start({ mode: 'hotseat', decks: [DECKS[g % 3] as string, DECKS[(g + 2) % 3] as string], seed: `mem-${g}` }), `mem-${g}`, ({ kind, before, after }) => {
        if (kind === 'handoff') {
          expect(after.game).toBe(before.game);
          return;
        }
        const events = after.game.state.log.slice(before.game.state.log.length);
        for (const v of [0, 1] as const) {
          const was = before.game.memory[v];
          const now = after.game.memory[v];
          const ok = knowable(after.game.state, events, v);
          for (const id of Object.keys(now)) {
            if (was[id] !== undefined) continue;
            learned++;
            expect(ok.has(id), `viewer ${v} learned ${id}`).toBe(true);
            expect(now[id]).toBe(after.game.state.cards[id]?.def);
          }
        }
      });
    }
    expect(learned).toBeGreaterThan(200);
  }, 120_000);

  it('the handoff screen carries no card data at all', () => {
    let seen = 0;
    for (let g = 0; g < 3; g++) {
      playOut(start({ mode: 'hotseat', decks: ['yellow', 'red'], seed: `hand-${g}` }), `hand-${g}`, ({ kind, before }) => {
        if (kind !== 'handoff') return;
        const text = JSON.stringify(handoffScreen(before));
        expect(text).not.toMatch(/p[01]-\d+/);
        for (const name of NAMES) expect(text.includes(name), name).toBe(false);
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(30);
  }, 60_000);

  it('the log names only cards the reader has seen; cards moving out of sight read "a card"', () => {
    let lines = 0;
    let unnamed = 0;
    playOut(start({ mode: 'hotseat', decks: ['blue', 'yellow'], seed: 'log-a' }), 'log-a', ({ kind, after }) => {
      if (kind !== 'human') return;
      for (const line of logFor(after, 60)) {
        lines++;
        if (line.text.includes('a card')) unnamed++;
        expect(line.text).not.toMatch(/undefined|NaN|\?/);
      }
      // Whoever holds the phone reads their own log only.
      const st = after.game.state;
      for (const e of projectEvents(st.log.slice(-10), after.holder ?? 0)) if (e.kind === 'move' && !canSee(after.holder ?? 0, e.to)) expect(e.card).toBe(HIDDEN);
    });
    expect(lines).toBeGreaterThan(1000);
    expect(unnamed).toBeGreaterThan(0);
  }, 120_000);
});
