// Decklists as text, one entry per line: "4 SYN/T01-001", "4x SYN/T01-001",
// optionally followed by the card's name (ignored). "#" starts a comment.
// The deck-building rules themselves (50 cards, 4 per name, 8 climaxes) are
// the engine's validateDeck (CR 5.1.2).

import { DECK_SIZE, lookupDef, validateDeck } from '../engine';
import type { CardCatalog } from '../engine';

export const DECKLIST_ISSUE_CODES = ['DECKLIST_TOO_LARGE', 'DECKLIST_LINE', 'DECKLIST_COUNT', 'DECKLIST_UNKNOWN'] as const;

export interface DecklistIssue {
  /** A DECKLIST_* code, or a DECK_* code from the engine's deck rules. */
  code: string;
  /** 1-based line number; 0 means the deck as a whole. */
  line: number;
  message: string;
}

export interface DecklistResult {
  ok: boolean;
  /** Card numbers, one per card, in list order. */
  deck: string[];
  issues: DecklistIssue[];
}

export const MAX_DECKLIST_CHARS = 20_000;
// The optional "x" is tied to its own spaces, so a run of spaces can be split only one way (no backtracking blow-up).
const ENTRY = /^(\d{1,3})(?:\s*[xX])?\s+([A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)*)(?:\s+.*)?$/;

/** Reads a decklist against a catalog. Never throws. */
export function parseDecklist(text: string, catalog: CardCatalog): DecklistResult {
  if (typeof text !== 'string' || text.length > MAX_DECKLIST_CHARS) {
    return { ok: false, deck: [], issues: [{ code: 'DECKLIST_TOO_LARGE', line: 0, message: `a decklist is text of at most ${MAX_DECKLIST_CHARS} characters` }] };
  }
  const deck: string[] = [];
  const issues: DecklistIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const content = raw.replace(/#.*$/, '').trim();
    if (content === '') return;
    const m = ENTRY.exec(content);
    if (!m) {
      issues.push({ code: 'DECKLIST_LINE', line, message: 'expected a count and a card number, like "4 SYN/T01-001"' });
      return;
    }
    const count = Number(m[1]);
    const number = (m[2] ?? '').toUpperCase();
    if (count < 1 || count > DECK_SIZE) {
      issues.push({ code: 'DECKLIST_COUNT', line, message: `the count must be 1 to ${DECK_SIZE}` });
      return;
    }
    if (!lookupDef(catalog, number)) {
      issues.push({ code: 'DECKLIST_UNKNOWN', line, message: `no card ${number} in this card set` });
      return;
    }
    for (let k = 0; k < count; k++) deck.push(number);
  });
  // Unknown cards are reported by line above; the engine adds size, copies and climax limits.
  for (const e of validateDeck(deck, catalog)) if (e.code !== 'DECK_UNKNOWN_CARD') issues.push({ code: e.code, line: 0, message: e.message });
  return { ok: issues.length === 0, deck, issues };
}

/** A deck as decklist text, one line per card number in first-seen order. */
export function formatDecklist(deck: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, n]) => `${n} ${id}`).join('\n') + '\n';
}
