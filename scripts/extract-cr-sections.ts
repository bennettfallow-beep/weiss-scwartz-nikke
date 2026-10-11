// Builds docs/cr-sections.json: the list of section numbers in the
// Comprehensive Rules, plus the PDF's sha256. Section numbers are facts, not
// rule text, so they can be committed; the PDF and its text stay in the
// gitignored docs/_private/. check-matrix uses this file to reject citations
// to sections that do not exist.
//
// Usage (needs the PDF locally and `pdftotext` from poppler-utils):
//   npm run rules:sections
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const PDF = join(ROOT, 'docs/_private/WSE-Comprehensive-Rules-v2.10.pdf');
const OUT = join(ROOT, 'docs/cr-sections.json');

const pdf = readFileSync(PDF);
const sha256 = createHash('sha256').update(pdf).digest('hex');
const text = execFileSync('pdftotext', [PDF, '-'], { encoding: 'utf8' });

const sections = new Set<string>();
for (const line of text.split('\n')) {
  // Section headings look like "7.2.1.4.1. Direct Attack: ..." or, in a few
  // places, "7.2.1.3.1.1 Unless ..." (no trailing dot).
  const m = /^(\d{1,2}(?:\.\d{1,2})+)\.?\s/.exec(line.trim());
  if (m?.[1]) sections.add(m[1]);
}

// The changelog (after "Changelog") also lists section numbers, but only ones
// that exist in the body, so the union is still exact.
const sorted = [...sections].sort((a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
});

const out = {
  document: 'Weiss Schwarz (English Edition) Comprehensive Rules',
  version: '2.10',
  lastUpdated: '2025-09-17',
  pdfSha256: sha256,
  count: sorted.length,
  sections: sorted,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUT}: ${sorted.length} sections, sha256 ${sha256}`);
