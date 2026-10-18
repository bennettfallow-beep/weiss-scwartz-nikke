// The no-peeking check for views and computer players: swap around the card
// definitions of every card one player cannot see (the opponent's hand, both
// decks and both stocks, apart from deck cards that player is looking at). What
// that player is shown must not change. Swapping definitions cannot catch a
// hidden card's id being shown (an id gives away its decklist slot), so
// hiddenIdsShown checks for that separately.
import { canSee, locate, nextInt, seedRng } from '../../src/engine';
import type { Action, CardId, GameState, GameView, PlayerId } from '../../src/engine';

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

/**
 * Ids of cards `viewer` cannot see that still appear in what that player is
 * shown now: the zones, the look, their own decision, and their legal actions.
 * Left out, because they name cards the player saw at the time, which may have
 * moved out of sight since: the log, effects, the current attack, the ability
 * being resolved, and the card whose ability is asking a question.
 */
export function hiddenIdsShown(state: GameState, viewer: PlayerId, view: GameView, legal: readonly Action[] = []): CardId[] {
  const hidden = new Set(hiddenFrom(state, viewer));
  const p = view.pending;
  const pending = p && (p.kind === 'pick' || p.kind === 'optional') && 'card' in p ? { ...p, card: null } : p;
  const text = JSON.stringify({ players: view.players, look: view.look, pending, legal });
  return [...text.matchAll(/"(p[01]-\d+)"/g)].map((m) => m[1] as CardId).filter((id) => hidden.has(id));
}
