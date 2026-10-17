// Reads a card-set file (docs/CARDS.md) into an engine catalog plus display
// information. Never throws: every problem comes back as an issue with a
// stable code and a path into the file.
//
// Lenient mode (the default) keeps a card playable when one of its abilities
// is not supported: that ability is left out of the engine catalog and its
// problems come back as warnings. Strict mode treats them as errors.

import { checkCardAbilities, validateCatalog } from '../engine';
import type { CardCatalog, CardDef } from '../engine';
import { CardRecordSchema, CardSetShellSchema, SCHEMA_VERSION } from './schema';
import type { CardRecord, CardSetFile } from './schema';
import { isNormalName, nameProblem, normalizeCardText, normalizeName } from './text';

export const IMPORT_ISSUE_CODES = [
  'IMPORT_TOO_LARGE',
  'IMPORT_JSON',
  'IMPORT_VERSION',
  'IMPORT_SHAPE',
  'IMPORT_FIELD',
  'IMPORT_RANGE',
  'IMPORT_VALUE',
  'IMPORT_FORMAT',
  'IMPORT_DUPLICATE',
  'IMPORT_NAME',
  'IMPORT_NAME_NORMALIZED',
  'IMPORT_REFERENCE',
  'IMPORT_ABILITY_DROPPED',
  'IMPORT_LIMIT',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface ImportIssue {
  severity: 'error' | 'warning';
  /** An IMPORT_* code, or a CATALOG_* / ABILITY_* code from the engine's checks. */
  code: string;
  /** Where in the file, e.g. "cards.3.abilities.0.effect.1.count"; "" is the whole file. */
  path: string;
  message: string;
}

/** What the screens show for a card. The engine never reads it. */
export interface CardDisplay {
  number: string;
  printedName?: string;
  text?: string[];
  unimplemented?: string[];
  rarity?: string;
  art?: { url: string };
  /** For each ability in the engine definition, its position in the file. */
  abilityIndex: number[];
}

export interface ImportResult {
  /** True when there are no errors (warnings allowed). */
  ok: boolean;
  /** The file as parsed, without cards whose shape is wrong (so unchanged when there are none); null when it could not be read. */
  set: CardSetFile | null;
  /** Engine definitions, by card number. Lenient: every card without errors. Strict: empty unless ok. */
  catalog: CardCatalog;
  display: Record<string, CardDisplay>;
  issues: ImportIssue[];
}

export interface ImportOptions {
  mode?: 'lenient' | 'strict';
}

export const MAX_FILE_CHARS = 4_000_000;
export const MAX_ISSUES = 200;

const pathOf = (parts: readonly PropertyKey[]): string => parts.map(String).join('.');

/** Zod issues as import issues: one per unknown key, codes from IMPORT_ISSUE_CODES. */
function fromZod(issue: { code: string; path: readonly PropertyKey[]; message: string; keys?: readonly string[] }): ImportIssue[] {
  const path = pathOf(issue.path);
  const error = (code: ImportIssueCode, at: string, message: string): ImportIssue => ({ severity: 'error', code, path: at, message });
  switch (issue.code) {
    case 'unrecognized_keys':
      return (issue.keys ?? []).map((key) => error('IMPORT_FIELD', path === '' ? key : `${path}.${key}`, `unknown field "${key}"`));
    case 'too_big':
    case 'too_small':
    case 'not_multiple_of':
      return [error('IMPORT_RANGE', path, issue.message)];
    case 'invalid_value':
      return [error('IMPORT_VALUE', path, issue.message)];
    case 'invalid_format':
      return [error('IMPORT_FORMAT', path, issue.message)];
    default:
      return [error('IMPORT_SHAPE', path, issue.message)];
  }
}

/** Every card-name string inside ability data (filters, selectors, conditions, triggers all use the key "name"). */
function namesIn(x: unknown, path: string, out: { path: string; name: string }[]): void {
  if (Array.isArray(x)) x.forEach((item, i) => namesIn(item, `${path}.${i}`, out));
  else if (typeof x === 'object' && x !== null) {
    for (const [key, value] of Object.entries(x)) {
      if (key === 'name' && typeof value === 'string') out.push({ path: `${path}.name`, name: value });
      else namesIn(value, `${path}.${key}`, out);
    }
  }
}

/** The engine definition for a record, with only the abilities that may be kept. */
function toDef(r: CardRecord, name: string, keep: readonly number[], keepEffect: boolean): CardDef {
  return {
    id: r.number,
    name,
    kind: r.kind,
    color: r.color,
    ...(r.level !== undefined ? { level: r.level } : {}),
    ...(r.cost !== undefined ? { cost: r.cost } : {}),
    ...(r.power !== undefined ? { power: r.power } : {}),
    ...(r.soul !== undefined ? { soul: r.soul } : {}),
    ...(r.traits !== undefined ? { traits: r.traits.map(normalizeName) } : {}),
    ...(r.triggers !== undefined ? { triggers: r.triggers } : {}),
    ...(r.counter !== undefined ? { counter: r.counter } : {}),
    ...(r.backup !== undefined ? { backup: r.backup } : {}),
    // Only abilities that passed checkCardAbilities are kept, so they are of the engine's types.
    ...(r.abilities !== undefined && keep.length > 0 ? { abilities: keep.map((i) => r.abilities?.[i]) as NonNullable<CardDef['abilities']> } : {}),
    ...(r.effect !== undefined && keepEffect ? { effect: r.effect as NonNullable<CardDef['effect']> } : {}),
  };
}

function toDisplay(r: CardRecord, keep: readonly number[]): CardDisplay {
  return {
    number: r.number,
    ...(r.printedName !== undefined ? { printedName: r.printedName } : {}),
    ...(r.text !== undefined ? { text: r.text.map(normalizeCardText) } : {}),
    ...(r.unimplemented !== undefined ? { unimplemented: r.unimplemented.map(normalizeCardText) } : {}),
    ...(r.rarity !== undefined ? { rarity: r.rarity } : {}),
    ...(r.art !== undefined ? { art: { url: r.art.url } } : {}),
    abilityIndex: [...keep],
  };
}

function readJson(text: string): { ok: true; value: unknown } | { ok: false; issue: ImportIssue } {
  if (typeof text !== 'string') return { ok: false, issue: { severity: 'error', code: 'IMPORT_JSON', path: '', message: 'the file must be text' } };
  if (text.length > MAX_FILE_CHARS) {
    return { ok: false, issue: { severity: 'error', code: 'IMPORT_TOO_LARGE', path: '', message: `the file is over ${MAX_FILE_CHARS} characters` } };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, issue: { severity: 'error', code: 'IMPORT_JSON', path: '', message: 'the file is not valid JSON' } };
  }
}

function capped(issues: ImportIssue[]): ImportIssue[] {
  if (issues.length <= MAX_ISSUES) return issues;
  const kept = issues.slice(0, MAX_ISSUES - 1);
  const more = issues.length - kept.length;
  return [...kept, { severity: issues.slice(kept.length).some((i) => i.severity === 'error') ? 'error' : 'warning', code: 'IMPORT_LIMIT', path: '', message: `and ${more} more issues` }];
}

const failed = (issues: ImportIssue[]): ImportResult => ({ ok: false, set: null, catalog: {}, display: {}, issues: capped(issues) });

/** Reads a card-set file. See docs/CARDS.md for the format and every issue code. */
export function importCardSet(text: string, options: ImportOptions = {}): ImportResult {
  const json = readJson(text);
  return json.ok ? importCardSetData(json.value, options) : failed([json.issue]);
}

/** Like importCardSet, for a file already parsed from JSON. */
export function importCardSetData(raw: unknown, options: ImportOptions = {}): ImportResult {
  const lenient = options.mode !== 'strict';
  const fail = failed;
  const version = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== SCHEMA_VERSION) {
    return fail([{ severity: 'error', code: 'IMPORT_VERSION', path: 'schemaVersion', message: `schemaVersion must be ${SCHEMA_VERSION}` }]);
  }
  const shell = CardSetShellSchema.safeParse(raw);
  if (!shell.success) return fail(shell.error.issues.flatMap(fromZod));

  // Each card on its own: a card with a wrong shape is reported and left out; the others go on.
  const issues: ImportIssue[] = [];
  const records: CardRecord[] = [];
  const fileIndex: number[] = [];
  shell.data.cards.forEach((card, i) => {
    const parsed = CardRecordSchema.safeParse(card);
    if (parsed.success) {
      records.push(parsed.data);
      fileIndex.push(i);
    } else issues.push(...parsed.error.issues.flatMap((issue) => fromZod({ ...issue, path: ['cards', i, ...issue.path] })));
  });
  const set: CardSetFile = { ...shell.data, cards: records };

  const add = (severity: ImportIssue['severity'], code: string, path: string, message: string) => issues.push({ severity, code, path, message });
  const cardErrors = new Set<number>();
  const firstAt = new Map<string, number>();
  const kept: { record: CardRecord; index: number; def: CardDef; display: CardDisplay }[] = [];

  records.forEach((r, k) => {
    const i = fileIndex[k] ?? k;
    const at = `cards.${i}`;
    const errorsBefore = issues.filter((x) => x.severity === 'error').length;
    const dup = firstAt.get(r.number);
    if (dup !== undefined) add('error', 'IMPORT_DUPLICATE', `${at}.number`, `card number ${r.number} is already used by cards.${dup}`);
    else firstAt.set(r.number, i);

    // CR 2.1.1.1-2.1.1.2: the rules name never carries reading aids or struck-through parts.
    const problem = nameProblem(r.name);
    if (problem) add('error', 'IMPORT_NAME', `${at}.name`, `name ${problem}`);
    const name = normalizeName(r.name);
    if (!problem && name !== r.name) add('warning', 'IMPORT_NAME_NORMALIZED', `${at}.name`, `name stored as "${name}" (spacing or Unicode form)`);
    r.traits?.forEach((t, k) => {
      if (!isNormalName(t)) add('error', 'IMPORT_NAME', `${at}.traits.${k}`, 'a trait must be written in normal form (no extra spaces or marks)');
    });

    // Abilities: one ability's problems drop that ability in lenient mode; problems with the list stay errors.
    const failed = new Set<number>();
    let effectFailed = false;
    for (const e of checkCardAbilities({ kind: r.kind, abilities: r.abilities, effect: r.effect }, at)) {
      const inner = e.path ?? '';
      const one = /^abilities\.(\d+)(?:\.|$)/.exec(inner);
      const inEffect = r.kind === 'event' && e.code !== 'ABILITY_KIND' && /^effect(?:\.|$)/.test(inner);
      if (lenient && one) failed.add(Number(one[1]));
      else if (lenient && inEffect) effectFailed = true;
      add(lenient && (one || inEffect) ? 'warning' : 'error', e.code, `${at}.${inner}`, e.message);
    }
    const keep = (r.abilities ?? []).map((_a, k) => k).filter((k) => !failed.has(k));
    for (const k of failed) add('warning', 'IMPORT_ABILITY_DROPPED', `${at}.abilities.${k}`, 'this ability is not supported; the card is played without it');
    if (effectFailed) add('warning', 'IMPORT_ABILITY_DROPPED', `${at}.effect`, "this event's effect is not supported; the event is played without it");

    // Names in kept abilities refer to cards by their rules name, so they must already be in normal form.
    const refs: { path: string; name: string }[] = [];
    keep.forEach((k) => namesIn(r.abilities?.[k], `${at}.abilities.${k}`, refs));
    if (r.effect !== undefined && !effectFailed) namesIn(r.effect, `${at}.effect`, refs);
    for (const ref of refs) if (!isNormalName(ref.name)) add('error', 'IMPORT_NAME', ref.path, 'a card name in an ability must be written in normal form');

    const def = toDef(r, name, keep, r.effect !== undefined && !effectFailed);
    if (issues.filter((x) => x.severity === 'error').length > errorsBefore) cardErrors.add(i);
    kept.push({ record: r, index: i, def, display: toDisplay(r, keep) });
  });

  // What each kind of card may have (CR 2.3-2.10), from the engine's own check, one card at a time and
  // without abilities (checked above).
  for (const k of kept) {
    const { abilities: _a, effect: _e, ...bare } = k.def;
    for (const e of validateCatalog({ [bare.id]: bare })) {
      cardErrors.add(k.index);
      add('error', e.code, `cards.${k.index}${e.path ? `.${e.path}` : ''}`, e.message);
    }
  }

  // A name in an ability that matches no card in this set is allowed (it may name a card from another set) but worth a look.
  const names = new Set(kept.map((k) => k.def.name));
  kept.forEach((k) => {
    const refs: { path: string; name: string }[] = [];
    k.display.abilityIndex.forEach((fileIndex) => namesIn(k.record.abilities?.[fileIndex], `cards.${k.index}.abilities.${fileIndex}`, refs));
    if (k.def.effect) namesIn(k.record.effect, `cards.${k.index}.effect`, refs);
    for (const ref of refs) if (!names.has(ref.name)) add('warning', 'IMPORT_REFERENCE', ref.path, `no card in this set is named "${ref.name}"`);
  });

  const ok = !issues.some((x) => x.severity === 'error');
  const usable = kept.filter((k) => !cardErrors.has(k.index) && firstAt.get(k.record.number) === k.index);
  const catalog: CardCatalog = ok || lenient ? Object.fromEntries(usable.map((k) => [k.def.id, k.def])) : {};
  const display: Record<string, CardDisplay> = ok || lenient ? Object.fromEntries(usable.map((k) => [k.def.id, k.display])) : {};
  return { ok, set, catalog, display, issues: capped(issues) };
}

/** A card-set file as text; importing it again gives back the same set. */
export function exportCardSet(set: CardSetFile): string {
  return `${JSON.stringify(set, null, 2)}\n`;
}
