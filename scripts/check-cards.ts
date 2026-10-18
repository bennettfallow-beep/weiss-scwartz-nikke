// Gate for card data (npm run check:cards):
//   - the SYN set imports strictly with no issues and its decks are legal;
//   - together the SYN cards use every part of the ability language;
//   - every SYN card renders as text, with no icon tokens left;
//   - schema/card-set.v1.json matches the format (--write regenerates it);
//   - no official card data is in git or about to be added (scripts/lib/ip-guard.ts).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cardSetJsonSchema, loadSyn, missingFeatures, allFeatures } from '../src/cards';
import { cardText } from '../src/engine';
import { ipGuard } from './lib/ip-guard';

const ROOT = join(__dirname, '..');
const SCHEMA_FILE = join(ROOT, 'schema', 'card-set.v1.json');
const write = process.argv.includes('--write');
const errors: string[] = [];

const syn = loadSyn();
for (const issue of syn.issues) errors.push(`SYN: ${JSON.stringify(issue)}`);
const defs = Object.values(syn.catalog);
for (const feature of missingFeatures(defs)) errors.push(`SYN never uses the ability feature ${feature}`);
for (const def of defs) {
  try {
    for (const line of cardText(def)) if (/[[【](STAND|REST|REVERSE)[\]】]/i.test(line)) errors.push(`${def.id}: text still has an icon token: ${line}`);
  } catch (e) {
    errors.push(`${def.id}: card text failed: ${String(e)}`);
  }
}

const schemaText = `${JSON.stringify(cardSetJsonSchema(), null, 2)}\n`;
if (write) writeFileSync(SCHEMA_FILE, schemaText);
else {
  let current = '';
  try {
    current = readFileSync(SCHEMA_FILE, 'utf8');
  } catch {
    // Reported below.
  }
  if (current !== schemaText) errors.push('schema/card-set.v1.json is stale; run npm run check:cards -- --write');
}

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
// Tracked files and new files git would add, so the guard runs before anything is committed.
const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter((f) => f !== ''))];
/** A file's text; null when it is binary (has a NUL byte) or has been deleted. */
const read = (file: string): string | null => {
  try {
    const bytes = readFileSync(join(ROOT, file));
    return bytes.subarray(0, 8000).includes(0) ? null : bytes.toString('utf8');
  } catch {
    return null;
  }
};
const ignored = (path: string) => {
  try {
    git(['check-ignore', '-q', path]);
    return true;
  } catch {
    return false;
  }
};
errors.push(...ipGuard({ files, read, ignored }));

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
const deckSizes = Object.values(syn.decks).map((d) => d.length);
console.log(
  `cards OK: SYN ${defs.length} cards, ${deckSizes.length} legal decks (${deckSizes.join('/')}), ${allFeatures().length}/${allFeatures().length} ability features, schema current, ${files.length} files in git or about to be hold no official card data`,
);
