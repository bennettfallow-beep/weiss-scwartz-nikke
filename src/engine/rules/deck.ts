// Deck construction (CR 5.1).

import type { CardCatalog, EngineError } from '../model/types';

export const DECK_SIZE = 50;
export const MAX_COPIES_PER_NAME = 4;
export const MAX_CLIMAX = 8;

/** Returns every way the deck breaks the construction rules (empty = legal). */
export function validateDeck(deck: readonly string[], catalog: CardCatalog): EngineError[] {
  const errors: EngineError[] = [];
  const unknown = [...new Set(deck.filter((id) => !catalog[id]))];
  for (const id of unknown) errors.push({ code: 'DECK_UNKNOWN_CARD', message: `unknown card "${id}"` });

  if (deck.length !== DECK_SIZE) {
    errors.push({ code: 'DECK_SIZE', message: `a deck must have exactly ${DECK_SIZE} cards, this one has ${deck.length}` });
  }

  // CR 5.1.2.2.1: cards with the same name share the limit even if other information differs.
  const byName = new Map<string, number>();
  let climaxes = 0;
  for (const id of deck) {
    const def = catalog[id];
    if (!def) continue;
    byName.set(def.name, (byName.get(def.name) ?? 0) + 1);
    if (def.kind === 'climax') climaxes += 1;
  }
  for (const [name, count] of byName) {
    if (count > MAX_COPIES_PER_NAME) {
      errors.push({ code: 'DECK_COPIES', message: `"${name}" appears ${count} times; the limit is ${MAX_COPIES_PER_NAME} per card name` });
    }
  }
  if (climaxes > MAX_CLIMAX) {
    errors.push({ code: 'DECK_CLIMAX', message: `${climaxes} climax cards; the limit is ${MAX_CLIMAX}` });
  }
  return errors;
}
