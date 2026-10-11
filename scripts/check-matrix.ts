// Validates docs/rules-matrix.json, the traceability table between the
// Comprehensive Rules and the engine, and regenerates the two docs derived from
// it (docs/rules-matrix.md, docs/KNOWN_GAPS.md).
//
//   npm run check:matrix                      validate; fail if generated docs are stale
//   npm run check:matrix -- --write           validate and rewrite generated docs
//   npm run check:matrix -- --milestone M1    also fail if any M1 row is still "planned"
//   npm run check:matrix -- --require-done    also fail if any row is still "planned"
//
// Row statuses:
//   planned   cited and in v1 scope, not yet implemented
//   verified  implemented (impl lists file#symbol) and covered by >= 1 test titled "[ID] ..."
//   deferred  real rule, not in v1; listed in KNOWN_GAPS.md and the in-app Help
//   out       no gameplay meaning for a digital 2-player engine
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { z } from 'zod';

const ROOT = join(__dirname, '..');
const MATRIX = join(ROOT, 'docs/rules-matrix.json');
const SECTIONS = join(ROOT, 'docs/cr-sections.json');
const MATRIX_MD = join(ROOT, 'docs/rules-matrix.md');
const GAPS_MD = join(ROOT, 'docs/KNOWN_GAPS.md');
const PRIVATE_TEXT = join(ROOT, 'docs/_private/cr-v2.10.txt');
const TEST_DIRS = ['tests', 'e2e'];

const MILESTONES = ['M1', 'M2', 'M3'] as const;

const Row = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/),
    area: z.string().regex(/^[A-Z]+$/),
    statement: z.string().min(10),
    sections: z.array(z.string().regex(/^\d{1,2}(\.\d{1,2})+$/)).min(1),
    status: z.enum(['planned', 'verified', 'deferred', 'out']),
    milestone: z.enum(['M1', 'M2', 'M3', 'none']),
    impl: z.array(z.string().regex(/^[\w./-]+#\w+$/)),
    notes: z.string(),
  })
  .strict();
type Row = z.infer<typeof Row>;

const Matrix = z
  .object({
    source: z.object({ document: z.string(), version: z.string(), pdfSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    areas: z.record(z.string(), z.string()),
    rows: z.array(Row),
  })
  .strict();

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const REQUIRE_DONE = args.includes('--require-done');
const milestoneArg = args[args.indexOf('--milestone') + 1];
const GATE = args.includes('--milestone') ? milestoneArg : undefined;
if (GATE !== undefined && !(MILESTONES as readonly string[]).includes(GATE)) {
  console.error(`--milestone must be one of ${MILESTONES.join(', ')}`);
  process.exit(2);
}

const errors: string[] = [];
const notes: string[] = [];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'artifacts') return [];
    if (statSync(full).isDirectory()) return listFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

// --- load -------------------------------------------------------------------
const parsed = Matrix.safeParse(JSON.parse(readFileSync(MATRIX, 'utf8')));
if (!parsed.success) {
  console.error('rules-matrix.json does not match the schema:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
const matrix = parsed.data;
const cr = JSON.parse(readFileSync(SECTIONS, 'utf8')) as { version: string; pdfSha256: string; sections: string[] };
const knownSections = new Set(cr.sections);

if (matrix.source.version !== cr.version) errors.push(`matrix cites CR v${matrix.source.version} but cr-sections.json is v${cr.version}`);
if (matrix.source.pdfSha256 !== cr.pdfSha256) errors.push('matrix source.pdfSha256 differs from docs/cr-sections.json');

// --- per-row checks ----------------------------------------------------------
const ids = new Set<string>();
for (const row of matrix.rows) {
  const where = row.id;
  if (ids.has(row.id)) errors.push(`${where}: duplicate id`);
  ids.add(row.id);
  if (!row.id.startsWith(`${row.area}-`)) errors.push(`${where}: id prefix does not match area ${row.area}`);
  if (!(row.area in matrix.areas)) errors.push(`${where}: area ${row.area} is not declared in "areas"`);
  for (const s of row.sections) if (!knownSections.has(s)) errors.push(`${where}: cites ${s}, which is not a section in CR v${cr.version}`);

  const inScope = row.status === 'planned' || row.status === 'verified';
  if (inScope && row.milestone === 'none') errors.push(`${where}: ${row.status} rows need a milestone`);
  if (!inScope && row.milestone !== 'none') errors.push(`${where}: ${row.status} rows must have milestone "none"`);
  if (row.status === 'verified' && row.impl.length === 0) errors.push(`${where}: verified rows must list impl (file#symbol)`);
  for (const ref of row.impl) {
    const [file, symbol] = ref.split('#') as [string, string];
    const full = join(ROOT, file);
    if (!existsSync(full)) errors.push(`${where}: impl file ${file} does not exist`);
    else if (!new RegExp(`\\b${symbol}\\b`).test(readFileSync(full, 'utf8'))) errors.push(`${where}: symbol ${symbol} not found in ${file}`);
  }
}

// --- tests that cite rows -----------------------------------------------------
const testsById = new Map<string, string[]>();
const TITLE = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
for (const file of TEST_DIRS.flatMap((d) => listFiles(join(ROOT, d)))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(TITLE)) {
    for (const ref of (m[2] ?? '').matchAll(/\[([A-Z]+-\d{2})\]/g)) {
      const id = ref[1] as string;
      if (!ids.has(id)) errors.push(`${relative(ROOT, file)}: test cites unknown rule id [${id}]`);
      testsById.set(id, [...(testsById.get(id) ?? []), relative(ROOT, file)]);
    }
  }
}
for (const row of matrix.rows) {
  const tests = testsById.get(row.id) ?? [];
  if (row.status === 'verified' && tests.length === 0) errors.push(`${row.id}: verified but no test title contains [${row.id}]`);
  if ((row.status === 'deferred' || row.status === 'out') && tests.length > 0) notes.push(`${row.id}: ${row.status} row has tests; consider its status`);
}

// --- gates ----------------------------------------------------------------------
const planned = matrix.rows.filter((r) => r.status === 'planned');
if (REQUIRE_DONE && planned.length > 0) errors.push(`--require-done: ${planned.length} rows still planned`);
if (GATE) {
  const upTo = MILESTONES.slice(0, MILESTONES.indexOf(GATE as (typeof MILESTONES)[number]) + 1) as readonly string[];
  const open = planned.filter((r) => upTo.includes(r.milestone));
  if (open.length > 0) errors.push(`--milestone ${GATE}: ${open.length} rows still planned: ${open.map((r) => r.id).join(', ')}`);
}

// --- copyright guard: no long verbatim runs from the CR (local only) -------------
if (existsSync(PRIVATE_TEXT)) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const crWords = norm(readFileSync(PRIVATE_TEXT, 'utf8'));
  const N = 10;
  const grams = new Set<string>();
  for (let i = 0; i + N <= crWords.length; i++) grams.add(crWords.slice(i, i + N).join(' '));
  for (const row of matrix.rows) {
    const w = norm(`${row.statement} ${row.notes}`);
    for (let i = 0; i + N <= w.length; i++) {
      if (grams.has(w.slice(i, i + N).join(' '))) {
        errors.push(`${row.id}: copies ${N}+ consecutive words from the CR ("${w.slice(i, i + N).join(' ')}"); paraphrase it`);
        break;
      }
    }
  }
} else {
  notes.push('docs/_private/cr-v2.10.txt not present: verbatim-copy guard skipped (expected in CI)');
}

// --- generated docs ---------------------------------------------------------------
function cite(r: Row): string {
  return r.sections.map((s) => `§${s}`).join(', ');
}
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

const byArea = new Map<string, Row[]>();
for (const r of matrix.rows) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
const count = (status: Row['status']) => matrix.rows.filter((r) => r.status === status).length;

const md: string[] = [
  '<!-- Generated by scripts/check-matrix.ts from docs/rules-matrix.json. Do not edit by hand. -->',
  '# Rules matrix',
  '',
  `Source: ${matrix.source.document} v${matrix.source.version}. Statements are paraphrases, not rule text.`,
  '',
  `Rows: ${matrix.rows.length} · verified ${count('verified')} · planned ${count('planned')} · deferred ${count('deferred')} · out ${count('out')}`,
  '',
];
for (const [area, rows] of byArea) {
  md.push(`## ${area}: ${matrix.areas[area] ?? ''}`, '', '| ID | Rule (paraphrase) | CR | Status | Milestone | Tests |', '|---|---|---|---|---|---|');
  for (const r of rows) {
    md.push(`| ${r.id} | ${oneLine(r.statement)} | ${cite(r)} | ${r.status} | ${r.milestone} | ${(testsById.get(r.id) ?? []).length} |`);
  }
  md.push('');
}

const gaps = matrix.rows.filter((r) => r.status === 'deferred');
const gapsMd: string[] = [
  '<!-- Generated by scripts/check-matrix.ts from docs/rules-matrix.json. Do not edit by hand. -->',
  '# Known gaps',
  '',
  `Rules from ${matrix.source.document} v${matrix.source.version} that v1 of the engine does not implement.`,
  'Cards whose text depends on these rules cannot be played as written. The in-app Help screen shows this same list.',
  '',
  `${gaps.length} deferred rules.`,
  '',
];
for (const [area, rows] of byArea) {
  const deferred = rows.filter((r) => r.status === 'deferred');
  if (deferred.length === 0) continue;
  gapsMd.push(`## ${area}: ${matrix.areas[area] ?? ''}`, '');
  for (const r of deferred) gapsMd.push(`- **${r.id}** (${cite(r)}): ${oneLine(r.statement)}${r.notes ? ` _${oneLine(r.notes)}_` : ''}`);
  gapsMd.push('');
}

const outputs: [string, string][] = [
  [MATRIX_MD, md.join('\n')],
  [GAPS_MD, gapsMd.join('\n')],
];
for (const [path, content] of outputs) {
  if (WRITE) writeFileSync(path, content);
  else if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
    errors.push(`${relative(ROOT, path)} is stale; run: npm run check:matrix -- --write`);
  }
}

// --- report ------------------------------------------------------------------------
const byMilestone = MILESTONES.map((m) => `${m} ${matrix.rows.filter((r) => r.milestone === m && r.status === 'planned').length}`).join(', ');
console.log(
  `rules matrix: ${matrix.rows.length} rows (verified ${count('verified')}, planned ${count('planned')} [${byMilestone}], deferred ${count('deferred')}, out ${count('out')})`,
);
for (const n of notes) console.log(`note: ${n}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s)`);
  process.exit(1);
}
console.log('rules matrix OK');
