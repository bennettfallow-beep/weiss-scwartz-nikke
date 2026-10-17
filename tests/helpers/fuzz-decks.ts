// Fuzz decks: the SYN test set (src/cards/sets/syn-001.json), three original
// 50-card decks loaded through the real importer and decklist reader. Between
// them they use every trigger icon, counter events, Backup, level 0-3, every
// card type, and every part of the ability language (npm run check:cards
// proves it), so random games reach the rare branches.
// tests/helpers/vanilla-decks.ts keeps the ability-free M2 version.

import { loadSyn } from '../../src/cards';
import type { CardCatalog } from '../../src/engine';

const syn = loadSyn();
if (!syn.ok) throw new Error(`the SYN set does not load: ${JSON.stringify(syn.issues.slice(0, 5))}`);

export const fuzzCatalog: CardCatalog = syn.catalog;

/** Three legal 50-card decks: yellow, red, blue. */
export const fuzzDecks: readonly (readonly string[])[] = [syn.decks.yellow, syn.decks.red, syn.decks.blue];
