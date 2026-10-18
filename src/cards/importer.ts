// Reads a card-set file (docs/CARDS.md) into an engine catalog plus display
// information. Never throws: every problem comes back as an issue with a
// stable code and a path into the file.
//
// Lenient mode (the default) keeps a card playable when one of its abilities
// is not supported: that ability is left out of the engine catalog and its
// problems come back as warnings. Strict mode treats them as errors.

import { checkCardAbilities, validateCatalog } from '../engine';
import type { CardCatalog, CardDef } from '../engine';
import { CARD_NUMBER, CardRecordSchema, CardSetShellSchema, SCHEMA_VERSION } from './schema';
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

/**
 * Every card-name string inside ability data (filters, selectors, conditions,
 * triggers all use the key "name"). Only called on abilities that passed
 * checkCardAbilities, whose depth is bounded.
 */
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

/**
 * Issues as they are found. Keeps at most MAX_ISSUES and counts the rest, and
 * counts errors as it goes, so a file with a huge number of problems still
 * costs time in proportion to its size.
 */
function issueList() {
  const kept: ImportIssue[] = [];
  let over = 0;
  let overError = false;
  let errors = 0;
  return {
    add: (issue: ImportIssue): void => {
      if (issue.severity === 'error') errors += 1;
      if (kept.length < MAX_ISSUES) kept.push(issue);
      else {
        over += 1;
        overError ||= issue.severity === 'error';
      }
    },
    errors: () => errors,
    /** The issues to report: all of them, or the first MAX_ISSUES - 1 and an IMPORT_LIMIT line. */
    list: (): ImportIssue[] => {
      if (over === 0) return kept;
      const shown = kept.slice(0, MAX_ISSUES - 1);
      const hidden = kept.slice(MAX_ISSUES - 1);
      const severity = overError || hidden.some((i) => i.severity === 'error') ? 'error' : 'warning';
      return [...shown, { severity, code: 'IMPORT_LIMIT', path: '', message: `and ${over + hidden.length} more issues` }];
    },
  };
}

/** How deeply one card's data may nest. Real cards need about 14 levels; the limit keeps every later walk bounded. */
export const MAX_CARD_DEPTH = 32;

/** Whether `root` nests deeper than `max` levels, found without recursion so no input can exhaust the stack. */
function nestsDeeperThan(root: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[root, 0]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [x, depth] = item;
    if (depth > max) return true;
    if (typeof x === 'object' && x !== null) for (const v of Object.values(x)) if (typeof v === 'object' && v !== null) stack.push([v, depth + 1]);
  }
  return false;
}

/** The card number of a raw card, if it is written correctly. */
function rawNumber(card: unknown): string | undefined {
  const n = typeof card === 'object' && card !== null && !Array.isArray(card) ? (card as { number?: unknown }).number : undefined;
  return typeof n === 'string' && n.length <= 32 && CARD_NUMBER.test(n) ? n : undefined;
}

const failed = (issues: readonly ImportIssue[]): ImportResult => {
  const list = issueList();
  issues.forEach(list.add);
  return { ok: false, set: null, catalog: {}, display: {}, issues: list.list() };
};

/** Reads a card-set file. See docs/CARDS.md for the format and every issue code. */
export function importCardSet(text: string, options: ImportOptions = {}): ImportResult {
  const json = readJson(text);
  return json.ok ? importCardSetData(json.value, options) : failed([json.issue]);
}

/** Like importCardSet, for a file already parsed from JSON. */
export function importCardSetData(raw: unknown, options: ImportOptions = {}): ImportResult {
  const lenient = options.mode !== 'strict';
  const version = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== SCHEMA_VERSION) {
    return failed([{ severity: 'error', code: 'IMPORT_VERSION', path: 'schemaVersion', message: `schemaVersion must be ${SCHEMA_VERSION}` }]);
  }
  const shell = CardSetShellSchema.safeParse(raw);
  if (!shell.success) return failed(shell.error.issues.flatMap(fromZod));

  const issues = issueList();
  const add = (severity: ImportIssue['severity'], code: string, path: string, message: string) => issues.add({ severity, code, path, message });

  // A card number belongs to the first card that uses it, even if that card is wrong in other ways.
  const owner = new Map<string, number>();
  shell.data.cards.forEach((card, i) => {
    const n = rawNumber(card);
    if (n === undefined) return;
    const first = owner.get(n);
    if (first === undefined) owner.set(n, i);
    else add('error', 'IMPORT_DUPLICATE', `cards.${i}.number`, `card number ${n} is already used by cards.${first}`);
  });

  // Each card on its own: a card with a wrong shape is reported and left out; the others go on.
  const records: { record: CardRecord; index: number }[] = [];
  shell.data.cards.forEach((card, i) => {
    if (nestsDeeperThan(card, MAX_CARD_DEPTH)) {
      add('error', 'IMPORT_RANGE', `cards.${i}`, `the card's data nests more than ${MAX_CARD_DEPTH} levels deep`);
      return;
    }
    const parsed = CardRecordSchema.safeParse(card);
    if (parsed.success) records.push({ record: parsed.data, index: i });
    else for (const issue of parsed.error.issues) for (const x of fromZod({ ...issue, path: ['cards', i, ...issue.path] })) issues.add(x);
  });

  const cardErrors = new Set<number>();
  const kept: { record: CardRecord; index: number; def: CardDef; display: CardDisplay; refs: { path: string; name: string }[] }[] = [];

  for (const { record: r, index: i } of records) {
    const at = `cards.${i}`;
    const errorsBefore = issues.errors();
    if (owner.get(r.number) !== i) cardErrors.add(i);

    // CR 2.1.1.1-2.1.1.2: the rules name never carries reading aids or struck-through parts.
    const problem = nameProblem(r.name);
    if (problem) add('error', 'IMPORT_NAME', `${at}.name`, `name ${problem}`);
    const name = normalizeName(r.name);
    if (!problem && name !== r.name) add('warning', 'IMPORT_NAME_NORMALIZED', `${at}.name`, `name stored as "${name}" (spacing, invisible characters or Unicode form)`);
    r.traits?.forEach((t, k) => {
      if (!isNormalName(t)) add('error', 'IMPORT_NAME', `${at}.traits.${k}`, 'a trait must be written in normal form (no extra spaces or marks)');
    });

    // Abilities: one ability's problems drop that ability in lenient mode; problems with the list stay errors.
    const bad = new Set<number>();
    let effectBad = false;
    let listBad = false;
    for (const e of checkCardAbilities({ kind: r.kind, abilities: r.abilities, effect: r.effect }, at)) {
      const inner = e.path ?? '';
      const one = /^abilities\.(\d+)(?:\.|$)/.exec(inner);
      const inEffect = r.kind === 'event' && e.code !== 'ABILITY_KIND' && /^effect(?:\.|$)/.test(inner);
      if (one) bad.add(Number(one[1]));
      else if (inEffect) effectBad = true;
      else listBad = true;
      add(lenient && (one || inEffect) ? 'warning' : 'error', e.code, `${at}.${inner}`, e.message);
    }
    const keep = listBad ? [] : (r.abilities ?? []).map((_a, k) => k).filter((k) => !bad.has(k));
    const keepEffect = !listBad && !effectBad && r.kind === 'event' && r.effect !== undefined;
    if (lenient) {
      for (const k of bad) add('warning', 'IMPORT_ABILITY_DROPPED', `${at}.abilities.${k}`, 'this ability is not supported; the card is played without it');
      if (effectBad) add('warning', 'IMPORT_ABILITY_DROPPED', `${at}.effect`, "this event's effect is not supported; the event is played without it");
    }

    // Names in abilities that passed the checks refer to cards by their rules name, so they must already be in normal form.
    const refs: { path: string; name: string }[] = [];
    keep.forEach((k) => namesIn(r.abilities?.[k], `${at}.abilities.${k}`, refs));
    if (keepEffect) namesIn(r.effect, `${at}.effect`, refs);
    for (const ref of refs) if (!isNormalName(ref.name)) add('error', 'IMPORT_NAME', ref.path, 'a card name in an ability must be written in normal form');

    if (issues.errors() > errorsBefore) cardErrors.add(i);
    kept.push({ record: r, index: i, def: toDef(r, name, keep, keepEffect), display: toDisplay(r, keep), refs });
  }

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
  for (const k of kept) for (const ref of k.refs) if (!names.has(ref.name)) add('warning', 'IMPORT_REFERENCE', ref.path, `no card in this set is named "${ref.name}"`);

  const ok = issues.errors() === 0;
  const usable = kept.filter((k) => !cardErrors.has(k.index));
  const catalog: CardCatalog = ok || lenient ? Object.fromEntries(usable.map((k) => [k.def.id, k.def])) : {};
  const display: Record<string, CardDisplay> = ok || lenient ? Object.fromEntries(usable.map((k) => [k.def.id, k.display])) : {};
  // With no card of the right shape left there is no valid set to give back.
  const set: CardSetFile | null = records.length > 0 ? { ...shell.data, cards: records.map((x) => x.record) } : null;
  return { ok, set, catalog, display, issues: issues.list() };
}

/** A card-set file as text; importing it again gives back an equal set. */
export function exportCardSet(set: CardSetFile): string {
  return `${JSON.stringify(set, null, 2)}\n`;
}
