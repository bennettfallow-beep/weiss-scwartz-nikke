// What each player has seen. Logs and prompts may name a card only if its
// player has seen it: the view names a card's definition only while the card
// is somewhere that player can see, and the log keeps naming cards that have
// since gone out of sight (a drawn card shuffled back, say).

import { projectEvents, projectView } from '../engine';
import type { CardId, GameEvent, GameState, PlayerId } from '../engine';
import type { Memory } from './types';

/** Collects every string in plain data that is a card instance id in `state`. */
function collect(value: unknown, state: GameState, out: Set<CardId>): void {
  if (typeof value === 'string') {
    if (Object.prototype.hasOwnProperty.call(state.cards, value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, state, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collect(v, state, out);
  }
}

/**
 * Adds to `memory` every card `viewer` can see in `state`, and every card the
 * events name once redacted for `viewer`. Returns the same object when nothing
 * is new.
 */
export function learn(memory: Memory, state: GameState, events: readonly GameEvent[], viewer: PlayerId): Memory {
  // No log in this view: only the new events matter, and they are added below.
  const view = projectView(state, viewer, { logSinceTurn: Number.MAX_SAFE_INTEGER });
  const seen = new Set<CardId>();
  collect({ players: view.players, look: view.look, pending: view.pending, resolving: view.resolving, attack: view.attack }, state, seen);
  collect(projectEvents(events, viewer), state, seen);
  let next: Record<CardId, string> | null = null;
  for (const id of seen) {
    if (memory[id] !== undefined) continue;
    const def = state.cards[id]?.def;
    if (def === undefined) continue;
    next ??= { ...memory };
    next[id] = def;
  }
  return next ?? memory;
}
