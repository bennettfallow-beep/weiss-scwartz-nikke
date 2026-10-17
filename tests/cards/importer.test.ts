// The card-set importer (src/cards/importer.ts): every problem is an issue with
// a stable code and path, it never throws, and lenient mode keeps cards
// playable without the abilities the engine cannot run.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { exportCardSet, importCardSet, importCardSetData, IMPORT_ISSUE_CODES, loadSyn, MAX_FILE_CHARS, MAX_ISSUES } from '../../src/cards';
import type { ImportIssue } from '../../src/cards';
import { validateDeck } from '../../src/engine';
import synFile from '../../src/cards/sets/syn-001.json';

type Json = Record<string, unknown>;
const character = (extra: Json = {}): Json => ({ number: 'TST/T01-001', name: 'Alpha', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 3000, soul: 1, ...extra });
const file = (cards: Json[], extra: Json = {}): Json => ({ schemaVersion: 1, set: { code: 'TST', name: 'Test set' }, cards, ...extra });
const errors = (issues: ImportIssue[]) => issues.filter((i) => i.severity === 'error').map((i) => `${i.code}@${i.path}`);
const warnings = (issues: ImportIssue[]) => issues.filter((i) => i.severity === 'warning').map((i) => `${i.code}@${i.path}`);
const drawOnPlay = { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'draw', count: 1 }] };

// Each row: a kind of bad input, the file (object, or raw text), and an error the importer must report.
const BAD: [string, Json | string, string][] = [
  ['text that is not JSON', '{"schemaVersion": 1,', 'IMPORT_JSON@'],
  ['a file over the size limit', ' '.repeat(MAX_FILE_CHARS + 1), 'IMPORT_TOO_LARGE@'],
  ['a list instead of a file object', '[1, 2]', 'IMPORT_VERSION@schemaVersion'],
  ['an unsupported schema version', file([character()], { schemaVersion: 2 }), 'IMPORT_VERSION@schemaVersion'],
  ['a missing set', { schemaVersion: 1, cards: [character()] }, 'IMPORT_SHAPE@set'],
  ['an unknown top-level field', file([character()], { extra: true }), 'IMPORT_FIELD@extra'],
  ['an unknown card field', file([character({ rules: 'x' })]), 'IMPORT_FIELD@cards.0.rules'],
  ['no cards', file([]), 'IMPORT_RANGE@cards'],
  ['a set code with lower-case letters', file([character()], { set: { code: 'tst', name: 'x' } }), 'IMPORT_FORMAT@set.code'],
  ['a card number in lower case', file([character({ number: 'tst/t01-001' })]), 'IMPORT_FORMAT@cards.0.number'],
  ['a card number with a space', file([character({ number: 'TST T01' })]), 'IMPORT_FORMAT@cards.0.number'],
  ['an unknown card kind', file([character({ kind: 'partner' })]), 'IMPORT_VALUE@cards.0.kind'],
  ['an unknown color', file([character({ color: 'purple' })]), 'IMPORT_VALUE@cards.0.color'],
  ['level 4', file([character({ level: 4 })]), 'IMPORT_RANGE@cards.0.level'],
  ['a fractional power', file([character({ power: 1500.5 })]), 'IMPORT_SHAPE@cards.0.power'],
  ['power as text', file([character({ power: '3000' })]), 'IMPORT_SHAPE@cards.0.power'],
  ['an unknown trigger icon', file([character({ triggers: ['bounce'] })]), 'IMPORT_VALUE@cards.0.triggers.0'],
  ['three trigger icons', file([character({ triggers: ['soul', 'soul', 'soul'] })]), 'IMPORT_RANGE@cards.0.triggers'],
  ['an art link that is not https', file([character({ art: { url: 'http://example.com/a.png' } })]), 'IMPORT_FORMAT@cards.0.art.url'],
  ['an art file instead of a link', file([character({ art: { file: 'a.png' } })]), 'IMPORT_FIELD@cards.0.art.file'],
  ['a rarity with spaces', file([character({ rarity: 'R R' })]), 'IMPORT_FORMAT@cards.0.rarity'],
  ['a printed line over 600 characters', file([character({ text: ['x'.repeat(601)] })]), 'IMPORT_RANGE@cards.0.text.0'],
  ['Backup without its stock cost', file([character({ backup: { power: 2000, level: 1 } })]), 'IMPORT_SHAPE@cards.0.backup.stock'],
  ['the same card number twice', file([character(), character({ name: 'Beta' })]), 'IMPORT_DUPLICATE@cards.1.number'],
  ['a name with a strike-through mark', file([character({ name: 'Al̶pha' })]), 'IMPORT_NAME@cards.0.name'],
  ['a name with reading-aid markup', file([character({ name: '<ruby>Alpha<rt>a</rt></ruby>' })]), 'IMPORT_NAME@cards.0.name'],
  ['a trait with extra spaces', file([character({ traits: [' Squad'] })]), 'IMPORT_NAME@cards.0.traits.0'],
  ['a climax with a level', file([{ number: 'TST/T01-002', name: 'Gate', kind: 'climax', color: 'yellow', level: 1 }]), 'CATALOG_FIELD@cards.0.level'],
  ['a character without power', file([character({ power: undefined })]), 'CATALOG_MISSING@cards.0.power'],
  ['traits on an event', file([{ number: 'TST/T01-003', name: 'Flash', kind: 'event', color: 'red', level: 0, cost: 0, traits: ['Squad'] }]), 'CATALOG_FIELD@cards.0.traits'],
  ['abilities on an event', file([{ number: 'TST/T01-003', name: 'Flash', kind: 'event', color: 'red', level: 0, cost: 0, abilities: [drawOnPlay] }]), 'ABILITY_KIND@cards.0.abilities'],
  ['five abilities on one card', file([character({ abilities: [drawOnPlay, drawOnPlay, drawOnPlay, drawOnPlay, drawOnPlay] })]), 'ABILITY_LIMIT@cards.0.abilities'],
  [
    'a card name in an ability with doubled spaces',
    file([character({ abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Amber  Surge' }, effect: [{ do: 'draw', count: 1 }] }] })]),
    'IMPORT_NAME@cards.0.abilities.0.trigger.name',
  ],
];

describe('importer: bad input', () => {
  it.each(BAD)('reports %s', (_label, input, expected) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const r = importCardSet(text);
    expect(r.ok).toBe(false);
    expect(errors(r.issues)).toContain(expected);
  });

  it('has at least 20 kinds of bad input, and a case for every import code', () => {
    expect(BAD.length).toBeGreaterThanOrEqual(20);
    const tested = new Set([...BAD.map(([, , e]) => e.split('@')[0]), 'IMPORT_NAME_NORMALIZED', 'IMPORT_REFERENCE', 'IMPORT_ABILITY_DROPPED', 'IMPORT_LIMIT']);
    expect(IMPORT_ISSUE_CODES.filter((c) => !tested.has(c))).toEqual([]);
  });

  it('a file that cannot be read gives no set and no cards', () => {
    const r = importCardSet('not json');
    expect(r).toMatchObject({ ok: false, set: null, catalog: {}, display: {} });
  });

  it(`stops listing problems after ${MAX_ISSUES}, saying how many more there are`, () => {
    const cards = Array.from({ length: 250 }, (_, i) => character({ number: `TST/T01-${String(i).padStart(3, '0')}`, level: 7 }));
    const r = importCardSet(JSON.stringify(file(cards)));
    expect(r.issues).toHaveLength(MAX_ISSUES);
    expect(r.issues.at(-1)).toMatchObject({ code: 'IMPORT_LIMIT', severity: 'error', message: 'and 51 more issues' });
  });
});

describe('importer: lenient and strict', () => {
  const twoAbilities = file([character({ abilities: [{ kind: 'automatic', trigger: { on: 'bogus' }, effect: [] }, drawOnPlay] })]);

  it('lenient (the default) keeps the card without the ability it cannot run, and says so', () => {
    const r = importCardSet(JSON.stringify(twoAbilities));
    expect(r.ok).toBe(true);
    expect(errors(r.issues)).toEqual([]);
    expect(warnings(r.issues)).toContain('IMPORT_ABILITY_DROPPED@cards.0.abilities.0');
    expect(warnings(r.issues)).toContain('ABILITY_TRIGGER@cards.0.abilities.0.trigger.on');
    expect(r.catalog['TST/T01-001']?.abilities).toEqual([drawOnPlay]);
    // The ability the engine runs is the file's second one.
    expect(r.display['TST/T01-001']?.abilityIndex).toEqual([1]);
  });

  it('strict treats the same ability as an error and gives no cards', () => {
    const r = importCardSet(JSON.stringify(twoAbilities), { mode: 'strict' });
    expect(r.ok).toBe(false);
    expect(errors(r.issues)).toContain('ABILITY_TRIGGER@cards.0.abilities.0.trigger.on');
    expect(r.catalog).toEqual({});
  });

  it("lenient drops an event's effect it cannot run; the event stays playable and does nothing", () => {
    const event = { number: 'TST/T01-003', name: 'Flash', kind: 'event', color: 'red', level: 0, cost: 0, effect: [{ do: 'draw', count: 9 }] };
    const r = importCardSet(JSON.stringify(file([event])));
    expect(r.ok).toBe(true);
    expect(warnings(r.issues)).toContain('IMPORT_ABILITY_DROPPED@cards.0.effect');
    expect(r.catalog['TST/T01-003']).not.toHaveProperty('effect');
  });

  it('lenient leaves out only the cards with errors', () => {
    const r = importCardSet(JSON.stringify(file([character(), character({ number: 'TST/T01-002', name: 'Beta', level: 9 })])));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.catalog)).toEqual(['TST/T01-001']);
  });

  it('warns when a name is stored in normal form, and when an ability names a card not in the set', () => {
    const r = importCardSet(
      JSON.stringify(file([character({ name: '  Alpha   Prime ', abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Amber Surge' }, effect: [{ do: 'draw', count: 1 }] }] })])),
    );
    expect(r.ok).toBe(true);
    expect(warnings(r.issues)).toEqual(expect.arrayContaining(['IMPORT_NAME_NORMALIZED@cards.0.name', 'IMPORT_REFERENCE@cards.0.abilities.0.trigger.name']));
    expect(r.catalog['TST/T01-001']?.name).toBe('Alpha Prime');
  });

  it('display information never reaches the engine, and printed text is normalized for display', () => {
    const r = importCardSet(
      JSON.stringify(file([character({ printedName: 'Alpha (reading)', rarity: 'RR', art: { url: 'https://example.com/a.png' }, unimplemented: ['[REST] this card in your CX phase'] })])),
    );
    expect(r.catalog['TST/T01-001']).toEqual({ id: 'TST/T01-001', name: 'Alpha', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 3000, soul: 1 });
    expect(r.display['TST/T01-001']).toEqual({
      number: 'TST/T01-001',
      printedName: 'Alpha (reading)',
      rarity: 'RR',
      art: { url: 'https://example.com/a.png' },
      unimplemented: ['Rest this card in your climax phase'],
      abilityIndex: [],
    });
  });
});

describe('importer: never throws, round trip', () => {
  it('any JSON value gives a result, never an exception', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const r = importCardSet(JSON.stringify(v));
        expect(typeof r.ok).toBe('boolean');
        expect(r.issues.length).toBeLessThanOrEqual(MAX_ISSUES);
      }),
      { seed: 20261017, numRuns: 400 },
    );
  });

  it('the SYN file with any one value replaced still gives a result, never an exception', () => {
    const paths: (string | number)[][] = [];
    const walk = (x: unknown, at: (string | number)[]) => {
      paths.push(at);
      if (Array.isArray(x)) x.forEach((v, i) => walk(v, [...at, i]));
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, [...at, k]);
    };
    walk(synFile, []);
    fc.assert(
      fc.property(fc.constantFrom(...paths.slice(1)), fc.jsonValue(), (path, value) => {
        const copy = structuredClone(synFile) as unknown as Record<string | number, unknown>;
        let node: Record<string | number, unknown> = copy;
        for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
        node[path.at(-1) as string | number] = value;
        for (const mode of ['lenient', 'strict'] as const) expect(typeof importCardSetData(copy, { mode }).ok).toBe('boolean');
      }),
      { seed: 20261017, numRuns: 500 },
    );
  });

  it('exporting and importing again gives back the same set', () => {
    const first = importCardSetData(synFile, { mode: 'strict' });
    expect(first.ok).toBe(true);
    const again = importCardSet(exportCardSet(first.set!), { mode: 'strict' });
    expect(again.set).toEqual(first.set);
    expect(again.catalog).toEqual(first.catalog);
  });

  it('the SYN set imports strictly with no issues, and its three decks are legal', () => {
    const syn = loadSyn();
    expect(syn.issues).toEqual([]);
    expect(Object.keys(syn.catalog)).toHaveLength(39);
    for (const deck of Object.values(syn.decks)) expect(validateDeck(deck, syn.catalog)).toEqual([]);
  });
});

describe('CARD-23: rules names', () => {
  it('[CARD-23] the rules name is stored without print-only marks: a reading aid kept in printedName never reaches the engine, and leftover marks in name are rejected', () => {
    const r = importCardSet(JSON.stringify(file([character({ name: 'Alpha', printedName: 'Alpha̶ <ruby>A<rt>a</rt></ruby>' })])));
    expect(r.ok).toBe(true);
    expect(r.catalog['TST/T01-001']?.name).toBe('Alpha');
    for (const name of ['Al̵pha', 'Alpha<rt>a</rt>', 'Al\npha']) {
      expect(errors(importCardSet(JSON.stringify(file([character({ name })]))).issues)).toContain('IMPORT_NAME@cards.0.name');
    }
  });

  it('[CARD-23] names that differ only in spacing or Unicode form are the same rules name, so they share the 4-copy limit', () => {
    const composed = 'Café Unit';
    const decomposed = 'Café  Unit ';
    const r = importCardSet(JSON.stringify(file([character({ number: 'TST/T01-001', name: composed }), character({ number: 'TST/T01-002', name: decomposed })])));
    expect(r.ok).toBe(true);
    expect(r.catalog['TST/T01-002']?.name).toBe(composed);
    const deck = [...Array<string>(3).fill('TST/T01-001'), ...Array<string>(2).fill('TST/T01-002')];
    expect(validateDeck(deck, r.catalog).map((e) => e.code)).toContain('DECK_COPIES');
  });
});
