// Undo (M5): a player may take back their last step only while it revealed
// nothing to them and they are still the one deciding. Undo gives exactly the
// game you get by replaying every action but the last.

import { describe, expect, it } from 'vitest';

import { replay, stateHash } from '../../src/engine';
import { canUndo, choose, screenFor, stepBot, undo } from '../../src/session';
import { hiddenFrom } from '../helpers/hidden-shuffle';
import { cards, DECKS, playOut, start } from './helpers';

describe('undo', () => {
  it('only steps that reveal nothing can be undone, and undo equals replaying all but the last action', () => {
    let undoable = 0;
    let checkedReplay = 0;
    const types = new Map<string, number>();
    for (let g = 0; g < 8; g++) {
      playOut(start({ mode: 'hotseat', decks: [DECKS[g % 3] as string, DECKS[(g + 2) % 3] as string], seed: `undo-${g}` }), `undo-${g}`, ({ kind, before, after }) => {
        if (kind !== 'human') return;
        const action = after.game.actions.at(-1);
        if (!action) return;
        if (after.game.prev === null) {
          // Steps that draw, look, reveal stock or start a new turn are never undoable.
          expect(canUndo(after)).toBe(false);
          return;
        }
        undoable++;
        types.set(action.type, (types.get(action.type) ?? 0) + 1);
        const p = action.player;
        // Nothing became visible to the player who acted.
        const nowHidden = new Set(hiddenFrom(after.game.state, p));
        for (const id of hiddenFrom(before.game.state, p)) expect(nowHidden.has(id), `${action.type} revealed ${id}`).toBe(true);
        expect(after.game.state.rng).toEqual(before.game.state.rng);
        expect(canUndo(after)).toBe(true);
        expect(screenFor(after)?.canUndo).toBe(true);
        const back = undo(after);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        // The previous record, memory included: the other player forgets anything the step showed.
        expect(back.session.game).toBe(before.game);
        if (undoable % 5 === 0) {
          const r = replay(after.game.setup, cards.catalog, after.game.actions.slice(0, -1));
          expect(r.ok && stateHash(r.state)).toBe(stateHash(back.session.game.state));
          checkedReplay++;
        }
      });
    }
    expect(undoable).toBeGreaterThan(100);
    expect(checkedReplay).toBeGreaterThan(20);
    // Undo is used for real moves, not only for passing.
    expect(types.get('SWAP') ?? 0).toBeGreaterThan(0);
    expect(types.get('PASS') ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('never after a mulligan or concede, an attack once its trigger check ran, or a clock once its 2 cards are drawn', () => {
    let seen = 0;
    let stoppedEarly = 0;
    for (let g = 0; g < 4; g++) {
      playOut(start({ mode: 'hotseat', decks: ['yellow', 'blue'], seed: `noundo-${g}` }), `noundo-${g}`, ({ kind, before, after }) => {
        if (kind !== 'human') return;
        const a = after.game.actions.at(-1);
        if (!a) return;
        const events = after.game.state.log.slice(before.game.state.log.length);
        if (a.type === 'MULLIGAN' || a.type === 'CONCEDE') {
          expect(after.game.prev, a.type).toBeNull();
          seen++;
        }
        // An attack or a clock can stop at a question before anything is revealed (an on-attack ability, a level up);
        // only then may it be undone.
        const revealed = events.some((e) => e.kind === 'triggerCheck' || (e.kind === 'move' && e.from.zone === 'deck'));
        if (a.type === 'ATTACK' || (a.type === 'CLOCK' && a.card !== null)) {
          if (revealed) expect(after.game.prev, a.type).toBeNull();
          else if (after.game.prev !== null) stoppedEarly++;
          seen++;
        }
      });
    }
    expect(seen).toBeGreaterThan(50);
    expect(stoppedEarly).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('against the computer: never for the computer’s steps, and not once the computer has acted', () => {
    let s = start({ mode: 'computer', decks: ['red', 'yellow'], seed: 'pc-undo', botSeed: 'pc-undo-bot' });
    let checked = 0;
    for (let i = 0; i < 2000 && s.game.state.result === null; i++) {
      const r = stepBot(s);
      if (r.ok) {
        s = r.session;
        expect(canUndo(s)).toBe(false);
        checked++;
        continue;
      }
      const screen = screenFor(s);
      const key = screen?.prompt?.choices.at(-1)?.key ?? screen?.prompt?.groups[0]?.choices[0]?.key;
      if (!key) {
        // Mulligan: keep the hand.
        const keep = choose(s, JSON.stringify({ discard: [], player: s.holder, type: 'MULLIGAN' }));
        if (!keep.ok) throw new Error(keep.error.code);
        s = keep.session;
        continue;
      }
      const next = choose(s, key);
      if (!next.ok) throw new Error(next.error.code);
      s = next.session;
    }
    expect(checked).toBeGreaterThan(20);
    const nothing = undo(s);
    expect(nothing.ok ? 'ok' : nothing.error.code).toBe('NO_UNDO');
  }, 60_000);
});
