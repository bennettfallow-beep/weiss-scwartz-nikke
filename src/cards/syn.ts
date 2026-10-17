// The SYN test set: 39 original cards in three 50-card decks that together use
// every part of the ability language (checked by npm run check:cards). The
// fuzz tests play them, and they will be the app's starter decks.

import type { CardCatalog } from '../engine';
import { parseDecklist } from './decklist';
import type { DecklistIssue } from './decklist';
import { importCardSetData } from './importer';
import type { CardDisplay, ImportIssue } from './importer';
import synDecks from './sets/syn-001-decks.json';
import synFile from './sets/syn-001.json';

export const SYN_DECK_NAMES = ['yellow', 'red', 'blue'] as const;
export type SynDeckName = (typeof SYN_DECK_NAMES)[number];

export interface StarterSet {
  ok: boolean;
  catalog: CardCatalog;
  display: Record<string, CardDisplay>;
  decks: Record<SynDeckName, string[]>;
  issues: (ImportIssue | (DecklistIssue & { deck: SynDeckName }))[];
}

/** Imports the SYN set (strict) and its decklists. `ok` is false if anything in them is wrong. */
export function loadSyn(): StarterSet {
  const set = importCardSetData(synFile, { mode: 'strict' });
  const lists: Record<string, readonly string[]> = synDecks;
  const decks = {} as Record<SynDeckName, string[]>;
  const deckIssues: (DecklistIssue & { deck: SynDeckName })[] = [];
  for (const name of SYN_DECK_NAMES) {
    const parsed = parseDecklist((lists[name] ?? []).join('\n'), set.catalog);
    decks[name] = parsed.deck;
    deckIssues.push(...parsed.issues.map((i) => ({ ...i, deck: name })));
  }
  return { ok: set.ok && deckIssues.length === 0, catalog: set.catalog, display: set.display, decks, issues: [...set.issues, ...deckIssues] };
}
