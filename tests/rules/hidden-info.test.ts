import { describe, expect, it } from 'vitest';

import { applyAction, HIDDEN, projectEvents, projectView } from '../../src/engine';
import { cardIn, makeState, ops } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

describe('hidden information in the log', () => {
  it('[ZONE-05] cards moved from a public zone into a hidden zone in an order the owner chose: others see how many, not which or in what order', () => {
    const s = makeState(catalog, { start: 'main', players: [{ waiting: ['Y0', 'Y1', 'Y2'], deck: ['B0'] }, { deck: ['R0'] }] });
    const work = ops.deepClone(s);
    const before = work.log.length;
    // Owner puts three waiting-room cards on top of the deck in an order they picked (an effect-style move).
    for (const def of ['Y2', 'Y0', 'Y1']) ops.moveCard(work, cardIn(work, 0, 'waiting', def), { player: 0, zone: 'deck' }, 'effect');
    for (const viewer of [0, 1] as const) {
      const moves = projectView(work, viewer).log.slice(before).filter((e) => e.kind === 'move');
      expect(moves).toHaveLength(3); // the number is public (CR 3.1.5.1.1)
      expect(moves.every((e) => e.kind === 'move' && e.card === HIDDEN)).toBe(true); // which card went where is not
    }
    // The deck itself shows only a count to everyone.
    expect(projectView(work, 1).players[0].counts.deck).toBe(4);
  });

  it('[ZONE-14] events returned by applyAction must be projected before showing: the opponent never sees a drawn card', () => {
    const s = makeState(catalog, { start: 'clock', players: [{ hand: ['Y0'], deck: ['B0', 'R0'] }, { deck: ['R0'] }] });
    const r = applyAction(s, catalog, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') });
    if (!r.ok) throw new Error(r.error.message);
    const draws = (viewer: 0 | 1) => projectEvents(r.events, viewer).filter((e) => e.kind === 'move' && e.reason === 'draw');
    expect(draws(0).every((e) => e.kind === 'move' && e.card !== HIDDEN)).toBe(true);
    expect(draws(1)).toHaveLength(2);
    expect(draws(1).every((e) => e.kind === 'move' && e.card === HIDDEN)).toBe(true);
  });
});
