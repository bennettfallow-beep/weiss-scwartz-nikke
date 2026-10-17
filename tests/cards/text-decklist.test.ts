// Printed-text normalization (CONC-15, CLIMAX-04), decklists and feature coverage.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allFeatures, featuresOf, formatDecklist, loadSyn, missingFeatures, normalizeCardText, parseDecklist } from '../../src/cards';
import { cardText } from '../../src/engine';

describe('CONC-15: stand, rest and reverse icons', () => {
  it('[CONC-15] the stand, rest and reverse icons in printed text read as the words they stand for', () => {
    expect(normalizeCardText('[REST] this card: draw 1.')).toBe('Rest this card: draw 1.');
    expect(normalizeCardText('Choose 1 of your characters and [STAND] it.')).toBe('Choose 1 of your characters and stand it.');
    expect(normalizeCardText('When this card becomes [REVERSE], draw 1.')).toBe('When this card becomes reversed, draw 1.');
    expect(normalizeCardText('If that character is 【REST】, it gets +1000.')).toBe('If that character is rested, it gets +1000.');
    expect(normalizeCardText('[stand] all of your characters')).toBe('Stand all of your characters');
  });

  it('[CONC-15] the engine writes the words itself: no SYN card text contains an icon token', () => {
    const syn = loadSyn();
    const lines = Object.values(syn.catalog).flatMap(cardText);
    expect(lines.length).toBeGreaterThan(30);
    expect(lines.filter((l) => /[[【](STAND|REST|REVERSE)[\]】]/i.test(l))).toEqual([]);
  });
});

describe('CLIMAX-04: "CX phase"', () => {
  it('[CLIMAX-04] "CX phase" in printed text means the climax phase; a bare "CX" is left alone', () => {
    expect(normalizeCardText('At the start of your CX phase, draw 1.')).toBe('At the start of your climax phase, draw 1.');
    expect(normalizeCardText('During your CX Phase, this card gets +500 power.')).toBe('During your Climax Phase, this card gets +500 power.');
    expect(normalizeCardText('CX phase: rest this card.')).toBe('Climax phase: rest this card.');
    expect(normalizeCardText('CX combo: when a CX is placed in your CX area')).toBe('CX combo: when a CX is placed in your CX area');
  });

  it('normalizing twice changes nothing', () => {
    const pieces = fc.constantFrom('[REST]', '[STAND]', '[REVERSE]', '【REST】', 'CX phase', 'CX Phase', 'CX', 'becomes ', 'is ', 'this card', '. ', ' ', 'phase', 'x');
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 12 }), (parts) => {
        const once = normalizeCardText(parts.join(''));
        expect(normalizeCardText(once)).toBe(once);
      }),
      { seed: 20261017, numRuns: 500 },
    );
  });
});

describe('decklists', () => {
  const { catalog, decks } = loadSyn();

  it('reads counts, "x", trailing names, comments and blank lines, matching card numbers in any case', () => {
    const r = parseDecklist('# yellow\n4 SYN/Y01-001  Amber Cadet\n\n2x syn/y01-011 # Flare\n', catalog);
    expect(r.issues.map((i) => i.code)).toEqual(['DECK_SIZE']);
    expect(r.deck).toEqual(['SYN/Y01-001', 'SYN/Y01-001', 'SYN/Y01-001', 'SYN/Y01-001', 'SYN/Y01-011', 'SYN/Y01-011']);
  });

  it('reports bad lines, counts and unknown cards by line, then the deck rules from the engine', () => {
    const r = parseDecklist('four SYN/Y01-001\n0 SYN/Y01-001\n5 SYN/Y01-002\n4 SYN/Z99-999\n', catalog);
    expect(r.issues.map((i) => `${i.code}@${i.line}`)).toEqual(['DECKLIST_LINE@1', 'DECKLIST_COUNT@2', 'DECKLIST_UNKNOWN@4', 'DECK_SIZE@0', 'DECK_COPIES@0']);
    expect(r.ok).toBe(false);
  });

  it('a too-large decklist is refused whole', () => {
    expect(parseDecklist('4 SYN/Y01-001\n'.repeat(2000), catalog).issues.map((i) => i.code)).toEqual(['DECKLIST_TOO_LARGE']);
  });

  it('formatting a deck and reading it back gives the same deck', () => {
    for (const deck of Object.values(decks)) {
      const again = parseDecklist(formatDecklist(deck), catalog);
      expect(again.ok).toBe(true);
      expect(again.deck).toEqual(deck);
    }
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        expect(typeof parseDecklist(text, catalog).ok).toBe('boolean');
      }),
      { seed: 20261017, numRuns: 300 },
    );
  });
});

describe('feature coverage', () => {
  it('the SYN set uses every part of the ability language', () => {
    expect(missingFeatures(Object.values(loadSyn().catalog))).toEqual([]);
  });

  it('a card set without abilities is missing every feature, and the feature list has no duplicates', () => {
    expect(featuresOf([]).size).toBe(0);
    expect(new Set(allFeatures()).size).toBe(allFeatures().length);
  });
});
