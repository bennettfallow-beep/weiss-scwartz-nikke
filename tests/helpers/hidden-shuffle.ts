// The no-peeking check for views and computer players: swap around the card
// definitions of every card one player cannot see (the opponent's hand, both
// decks and both stocks, apart from deck cards that player is looking at). What
// that player is shown must not change.
import { canSee, locate, nextInt, seedRng } from '../../src/engine';
import type { CardId, GameState, PlayerId } from '../../src/engine';

/** Cards `viewer` cannot see in `state`. */
export function hiddenFrom(state: GameState, viewer: PlayerId): CardId[] {
  const look = state.resolving?.look;
  const looking = look && look.player === viewer ? new Set(look.cards.map((r) => r.card)) : new Set<CardId>();
  return Object.keys(state.cards)
    .sort()
    .filter((id) => {
      const at = locate(state, id);
      return at !== null && !canSee(viewer, at) && !looking.has(id);
    });
}

/**
 * A copy of `state` in which the hidden cards' definitions are dealt out again at
 * random. `changed` counts the cards whose definition differs, so a caller can
 * check that something really was swapped.
 */
export function shuffleHidden(state: GameState, viewer: PlayerId, seed: string): { state: GameState; changed: number } {
  const ids = hiddenFrom(state, viewer);
  const defs = ids.map((id) => state.cards[id]?.def as string);
  let rng = seedRng(seed);
  for (let i = defs.length - 1; i > 0; i--) {
    const [j, next] = nextInt(rng, i + 1);
    rng = next;
    [defs[i], defs[j]] = [defs[j] as string, defs[i] as string];
  }
  const cards = { ...state.cards };
  let changed = 0;
  ids.forEach((id, k) => {
    const card = cards[id];
    if (!card) return;
    if (card.def !== defs[k]) changed++;
    cards[id] = { ...card, def: defs[k] as string };
  });
  return { state: { ...state, cards }, changed };
}
