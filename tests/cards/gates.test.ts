// The JSON Schema file stays in step with the format, and the IP guard catches
// official card data in git (scripts/lib/ip-guard.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cardSetJsonSchema } from '../../src/cards';
import { ipGuard } from '../../scripts/lib/ip-guard';

describe('card format JSON Schema', () => {
  it('schema/card-set.v1.json is the schema generated from the format (npm run check:cards -- --write)', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '..', '..', 'schema', 'card-set.v1.json'), 'utf8')) as unknown;
    expect(file).toEqual(cardSetJsonSchema());
  });
});

describe('IP guard', () => {
  // Built at run time, so this file itself holds no official-looking card number.
  const code = ['N', 'IK'].join('');
  const official = `${code}/S99-E001`;
  const clean = { files: ['src/a.ts'], read: () => 'const id = "SYN/Y01-001"; const path = "docs/rules-matrix.md";', ignored: () => true };
  const problemsWith = (text: string, file = 'src/a.ts') => ipGuard({ ...clean, files: [file], read: () => text });

  it('passes original card numbers and ordinary paths', () => {
    expect(ipGuard(clean)).toEqual([]);
  });

  it('flags a card number from another set, with file and line, however it is written', () => {
    expect(problemsWith(`ok\nconst id = "${official}";`)).toEqual([expect.stringContaining('src/a.ts:2')]);
    for (const written of [official.toLowerCase(), `${code}\\/S99-E001`, `${code}\\u002fS99-E001`, `${code}/S99-001`, `${code}/S99-PE01`]) {
      expect(problemsWith(`x ${written} y`)).toHaveLength(1);
    }
  });

  it('checks every text file, whatever its type', () => {
    for (const file of ['tests/fixtures/page.html', 'data/cards.csv', 'notes/LIST.TXT', 'Makefile']) expect(problemsWith(official, file)).toHaveLength(1);
    expect(ipGuard({ ...clean, read: () => null })).toEqual([]);
  });

  it('flags personal card files in git, a personal folder git does not ignore, and card files in git with art or a foreign set code', () => {
    expect(ipGuard({ ...clean, files: ['local-cards/set.json'] })[0]).toContain('must never be committed');
    expect(ipGuard({ ...clean, ignored: () => false })[0]).toContain('not ignored');
    const withArt = '{ "set": { "code": "TST" }, "cards": [{ "art": { "url": "https://example.com/a.png" } }] }';
    expect(problemsWith(withArt, 'tests/fixtures/x.json')).toEqual([expect.stringContaining('must not link card art')]);
    expect(problemsWith(`{ "set": { "code": "${code}" }, "cards": [] }`, 'cards/x.json')).toEqual([expect.stringContaining('not an original set')]);
  });
});
