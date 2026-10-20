// The card sets the app can play. M5 has the built-in starter decks only;
// personal card files arrive in M6.

import { loadSyn, SYN_DECK_NAMES } from '../cards';
import { catalogFingerprint } from './canonical';
import type { CardSource } from './types';

const STARTER_DECK_NAMES: Readonly<Record<string, string>> = { yellow: 'Yellow deck', red: 'Red deck', blue: 'Blue deck' };

/** The built-in starter set. `ok` is false only if the bundled data is broken. */
export function starterCards(): { ok: boolean; source: CardSource } {
  const syn = loadSyn();
  const decks: Record<string, readonly string[]> = {};
  const deckNames: Record<string, string> = {};
  for (const name of SYN_DECK_NAMES) {
    decks[name] = syn.decks[name];
    deckNames[name] = STARTER_DECK_NAMES[name] ?? name;
  }
  return {
    ok: syn.ok,
    source: { catalog: syn.catalog, display: syn.display, decks, deckNames, fingerprint: catalogFingerprint(syn.catalog), label: 'Starter decks' },
  };
}
