// Fails if any file under assets/ lacks an entry in assets/LICENSES.json, or
// if an entry points at a file that no longer exists. Keeps the IP rule
// enforceable: every bundled image has a stated source and license.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { z } from 'zod';

const ROOT = join(__dirname, '..');
const ASSETS = join(ROOT, 'assets');
const LEDGER = join(ASSETS, 'LICENSES.json');

const Entry = z.object({ source: z.string().min(3), license: z.string().min(2), notes: z.string().optional() }).strict();
const Ledger = z.record(z.string(), Entry);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const ledger = Ledger.parse(JSON.parse(readFileSync(LEDGER, 'utf8')));
const errors: string[] = [];
const exempt = new Set(['LICENSES.json']);
const files = listFiles(ASSETS)
  .map((f) => relative(ASSETS, f).split('\\').join('/'))
  .filter((f) => !exempt.has(f) && !f.startsWith('licenses/'));

for (const f of files) if (!(f in ledger)) errors.push(`assets/${f} has no entry in assets/LICENSES.json`);
for (const f of Object.keys(ledger)) if (!existsSync(join(ASSETS, f))) errors.push(`assets/LICENSES.json lists ${f}, which does not exist`);

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log(`assets OK: ${files.length} files, all licensed`);
