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
  const official = ['NIK', 'S99-E001'].join('/');
  const clean = { tracked: ['src/a.ts'], read: () => 'const id = "SYN/Y01-001";', ignored: () => true };

  it('passes original card numbers', () => {
    expect(ipGuard(clean)).toEqual([]);
  });

  it('flags a card number from another set in a tracked file, with file and line', () => {
    const problems = ipGuard({ ...clean, read: () => `ok\nconst id = "${official}";` });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/a.ts:2');
  });

  it('flags tracked personal card files, a personal folder git does not ignore, and art links in tracked card files', () => {
    expect(ipGuard({ ...clean, tracked: ['local-cards/set.json'] })[0]).toContain('must never be committed');
    expect(ipGuard({ ...clean, ignored: () => false })[0]).toContain('not ignored');
    expect(ipGuard({ ...clean, tracked: ['src/cards/sets/x.json'], read: () => '{ "art": { "url": "https://example.com/a.png" } }' })[0]).toContain('must not link card art');
  });
});
