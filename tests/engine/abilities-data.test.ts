// Engine tests for the ability language as data (M3a): the static checker in
// src/engine/model/abilityCheck.ts and the card-text renderer in
// src/engine/model/text.ts. These are not rules-matrix rows, so no title
// starts with a row id.
//
// The checker works on untrusted input (an imported card file): every problem
// must come back as an error value with a stable code and an exact path, never
// as an exception, and sizes and nesting are capped before it looks deeper.
// The renderer must give the same plain English for the same data every time.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ABILITY_ERROR_CODES,
  ABILITY_LIMITS,
  abilityText,
  cardText,
  checkCardAbilities,
  COLORS,
  conditionText,
  costText,
  COUNT_ZONES,
  effectText,
  validateCatalog,
} from '../../src/engine';
import type {
  Ability,
  CardCatalog,
  CardDef,
  CardFilter,
  CardKind,
  Color,
  Condition,
  CostPart,
  CountSpec,
  CountZone,
  Modifier,
  Selector,
  Side,
  Step,
  Target,
  Trigger,
} from '../../src/engine';
import { catalog } from '../helpers/catalog';

// --- Helpers -----------------------------------------------------------------

/** What the checker sees: a card kind and raw (possibly malformed) ability data. */
interface RawCard {
  readonly kind: string;
  readonly abilities?: unknown;
  readonly effect?: unknown;
}

/** The checker's problems as "CODE@path", in the order reported. */
function problems(def: RawCard, at = 'card T'): string[] {
  return checkCardAbilities(def, at).map((e) => `${e.code}@${e.path ?? '(no path)'}`);
}

const ch = (abilities: unknown): RawCard => ({ kind: 'character', abilities });
const cx = (abilities: unknown): RawCard => ({ kind: 'climax', abilities });
const ev = (effect: unknown): RawCard => ({ kind: 'event', effect });

const draw1 = { do: 'draw', count: 1 };
const stock1 = { pay: 'stock', count: 1 };
const plus500 = { stat: 'power', amount: 500, target: 'this' };
const turnYou = { if: 'turn', side: 'you' };
const cont = (more: object = {}) => ({ kind: 'continuous', modifiers: [plus500], ...more });
const auto = (effect: unknown, more: object = {}) => ({ kind: 'automatic', trigger: { on: 'play' }, effect, ...more });
const actv = (cost: unknown, effect: unknown = [draw1], more: object = {}) => ({ kind: 'activated', timing: 'main', cost, effect, ...more });
/** A character whose one continuous ability has these conditions (paths abilities.0.when.N...). */
const withWhen = (...when: unknown[]) => ch([cont({ when })]);
/** A character whose one continuous ability has these modifiers (paths abilities.0.modifiers.N...). */
const withMods = (...modifiers: unknown[]) => ch([{ kind: 'continuous', modifiers }]);
const repeat = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);
const chars = (n: number) => 'x'.repeat(n);

// Synthetic card definitions (original names, invented for these tests).
const unit = (id: string, name: string, abilities: Ability[], more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 2000,
  soul: 1,
  abilities,
  ...more,
});
const climaxCard = (id: string, name: string, abilities: Ability[]): CardDef => ({ id, name, kind: 'climax', color: 'yellow', abilities });
const eventCard = (id: string, name: string, effect?: Step[]): CardDef => ({ id, name, kind: 'event', color: 'yellow', level: 0, cost: 0, ...(effect ? { effect } : {}) });
const byId = (defs: readonly CardDef[]): CardCatalog => Object.fromEntries(defs.map((d) => [d.id, d]));

// =============================================================================
// The checker: codes and limits
// =============================================================================

describe('ability checker: error codes and limits', () => {
  it('has a fixed list of twelve error codes', () => {
    expect([...ABILITY_ERROR_CODES]).toEqual([
      'ABILITY_SHAPE',
      'ABILITY_KIND',
      'ABILITY_TRIGGER',
      'ABILITY_TIMING',
      'ABILITY_COST',
      'ABILITY_STEP',
      'ABILITY_RANGE',
      'ABILITY_FILTER',
      'ABILITY_CONDITION',
      'ABILITY_TARGET',
      'ABILITY_REF',
      'ABILITY_LIMIT',
    ]);
  });

  it('has these size limits', () => {
    expect(ABILITY_LIMITS).toEqual({ abilities: 4, steps: 8, depth: 3, count: 5, lookCount: 10, power: 20000, soul: 3, damage: 5, text: 40 });
  });
});

// =============================================================================
// One bad card per error code, each with exactly one problem at an exact path
// =============================================================================

const ONE_PER_CODE: readonly (readonly [string, RawCard, string])[] = [
  ['ABILITY_SHAPE', ch([cont({ note: 'extra' })]), 'abilities.0.note'],
  ['ABILITY_KIND', ch([{ kind: 'passive', modifiers: [plus500] }]), 'abilities.0.kind'],
  ['ABILITY_TRIGGER', ch([{ kind: 'automatic', trigger: { on: 'damaged' }, effect: [draw1] }]), 'abilities.0.trigger.on'],
  ['ABILITY_TIMING', ch([{ kind: 'activated', timing: 'climax', cost: [stock1], effect: [draw1] }]), 'abilities.0.timing'],
  ['ABILITY_COST', ch([actv([stock1, { pay: 'clock', count: 1 }])]), 'abilities.0.cost.1.pay'],
  ['ABILITY_STEP', ev([draw1, { do: 'mill', count: 2 }]), 'effect.1.do'],
  ['ABILITY_RANGE', ch([auto([{ do: 'draw', count: 0 }])]), 'abilities.0.effect.0.count'],
  ['ABILITY_FILTER', ev([{ do: 'salvage', count: 1, filter: { color: 'purple' } }]), 'effect.0.filter.color'],
  ['ABILITY_CONDITION', withWhen({ if: 'phase', side: 'you' }), 'abilities.0.when.0.if'],
  ['ABILITY_TARGET', ev([{ do: 'power', amount: 1000, target: 'self' }]), 'effect.0.target'],
  [
    'ABILITY_REF',
    ev([
      { do: 'choose', as: 'foe', count: 1, what: { side: 'opponent' } },
      { do: 'returnToHand', target: { ref: 'fo' } },
    ]),
    'effect.1.target.ref',
  ],
  ['ABILITY_LIMIT', ch(repeat(5, cont())), 'abilities'],
];

describe('ability checker: one bad card per error code', () => {
  it('the table below has exactly one bad card for every error code', () => {
    expect(ONE_PER_CODE.map(([code]) => code)).toEqual([...ABILITY_ERROR_CODES]);
  });

  it.each(ONE_PER_CODE)('%s: the bad card gets exactly that one problem, at its exact path', (code, def, path) => {
    expect(problems(def)).toEqual([`${code}@${path}`]);
  });

  it('labels each message with the card and the path, and keeps code and path as separate fields', () => {
    expect(checkCardAbilities(ev([{ do: 'draw', count: 0 }]), 'card EV-X')).toEqual([
      { code: 'ABILITY_RANGE', path: 'effect.0.count', message: 'card EV-X: effect.0.count: must be a whole number from 1 to 5' },
    ]);
    expect(checkCardAbilities(ch([{ kind: 'passive' }]), 'card CH-Y')).toEqual([
      { code: 'ABILITY_KIND', path: 'abilities.0.kind', message: 'card CH-Y: abilities.0.kind: must be one of activated, automatic, continuous' },
    ]);
  });

  it('reports every problem on a card, in the order the data is written, not just the first', () => {
    expect(problems(ev([{ do: 'draw', count: 0 }, { do: 'mill' }, { do: 'power', amount: 0, target: 'self' }]))).toEqual([
      'ABILITY_RANGE@effect.0.count',
      'ABILITY_STEP@effect.1.do',
      'ABILITY_RANGE@effect.2.amount',
      'ABILITY_TARGET@effect.2.target',
    ]);
    expect(problems(ch([cont(), auto([{ do: 'heal', count: 6 }]), { kind: 'continuous', modifiers: [{ stat: 'soul', amount: 4, target: 'this' }] }]))).toEqual([
      'ABILITY_RANGE@abilities.1.effect.0.count',
      'ABILITY_RANGE@abilities.2.modifiers.0.amount',
    ]);
  });

  it('validateCatalog passes the problems on with the catalog key as the card label', () => {
    const bad: CardDef = { ...unit('BAD', 'Faulty Relay', []), abilities: [auto([{ do: 'draw', count: 9 }]) as unknown as Ability] };
    const errors = validateCatalog({ ...catalog, BAD: bad }).filter((e) => e.code.startsWith('ABILITY_'));
    expect(errors).toEqual([
      { code: 'ABILITY_RANGE', path: 'abilities.0.effect.0.count', message: 'card BAD: abilities.0.effect.0.count: must be a whole number from 1 to 5' },
    ]);
  });
});

// =============================================================================
// More bad cards for each code
// =============================================================================

type Case = readonly [string, RawCard, readonly string[]];

const SHAPE_CASES: readonly Case[] = [
  ['abilities is not a list', ch(cont()), ['ABILITY_SHAPE@abilities']],
  ['abilities is an empty list', ch([]), ['ABILITY_SHAPE@abilities']],
  ['abilities is null', ch(null), ['ABILITY_SHAPE@abilities']],
  ['an event effect is an empty list', ev([]), ['ABILITY_SHAPE@effect']],
  ['a required field is missing', ch([{ kind: 'automatic', trigger: { on: 'play' } }]), ['ABILITY_SHAPE@abilities.0.effect']],
  ['an activated ability with no cost parts', ch([actv([])]), ['ABILITY_SHAPE@abilities.0.cost']],
  ['a cost part with an unknown field', ch([actv([{ pay: 'stock', count: 1, from: 'top' }])]), ['ABILITY_SHAPE@abilities.0.cost.0.from']],
  ['upTo present but not true', ev([{ do: 'draw', count: 2, upTo: false }]), ['ABILITY_SHAPE@effect.0.upTo']],
  ['player present but not "opponent"', ev([{ do: 'discard', count: 1, player: 'you' }]), ['ABILITY_SHAPE@effect.0.player']],
  ['a field that belongs to another step kind', ev([{ do: 'draw', count: 1, filter: { kind: 'character' } }]), ['ABILITY_SHAPE@effect.0.filter']],
  ['a filter that is not an object', ev([{ do: 'salvage', count: 1, filter: 'red' }]), ['ABILITY_SHAPE@effect.0.filter']],
  ['a level range with an unknown key', ev([{ do: 'salvage', count: 1, filter: { level: { exactly: 1 } } }]), ['ABILITY_SHAPE@effect.0.filter.level.exactly']],
  ['a selector with a card kind (selectors are always characters)', ev([{ do: 'choose', as: 'a', count: 1, what: { side: 'you', kind: 'character' } }]), ['ABILITY_SHAPE@effect.0.what.kind']],
  ['a selector without a side', ev([{ do: 'choose', as: 'a', count: 1, what: { trait: 'Squad' } }]), ['ABILITY_SHAPE@effect.0.what.side']],
  ['"other" present but not true', withMods({ stat: 'power', amount: 500, target: { side: 'you', other: false } }), ['ABILITY_SHAPE@abilities.0.modifiers.0.target.other']],
  ['a trigger name on a trigger other than climaxPlayed', ch([{ kind: 'automatic', trigger: { on: 'play', name: 'Ember Gate' }, effect: [draw1] }]), ['ABILITY_SHAPE@abilities.0.trigger.name']],
  ['a turn condition without a side', withWhen({ if: 'turn' }), ['ABILITY_SHAPE@abilities.0.when.0.side']],
  ['a count condition whose spec has no side', withWhen({ if: 'count', what: { zone: 'waiting' }, min: 1 }), ['ABILITY_SHAPE@abilities.0.when.0.what.side']],
  ['a modifier without a target', withMods({ stat: 'power', amount: 500 }), ['ABILITY_SHAPE@abilities.0.modifiers.0.target']],
  ['a look take without a destination', ev([{ do: 'lookTop', count: 3, take: { count: 1 }, rest: 'top' }]), ['ABILITY_SHAPE@effect.0.take.to']],
  [
    'a ref target with an extra field',
    ev([
      { do: 'choose', as: 'a', count: 1, what: { side: 'you' } },
      { do: 'power', amount: 1000, target: { ref: 'a', all: { side: 'you' } } },
    ]),
    ['ABILITY_SHAPE@effect.1.target.all'],
  ],
  ['a may step whose steps is not a list', ev([{ do: 'may', steps: draw1 }]), ['ABILITY_STEP@effect.0.steps', 'ABILITY_SHAPE@effect.0.steps']],
  ['a rest cost part with a count', ch([actv([{ pay: 'rest', count: 1 }])]), ['ABILITY_SHAPE@abilities.0.cost.0.count']],
  ['a selfToWaiting cost part with a count', ch([actv([{ pay: 'selfToWaiting', count: 1 }])]), ['ABILITY_SHAPE@abilities.0.cost.0.count']],
  ['an optional cost with no parts', ch([auto([draw1], { cost: [] })]), ['ABILITY_SHAPE@abilities.0.cost']],
  ['a continuous ability with no modifiers', ch([{ kind: 'continuous', modifiers: [] }]), ['ABILITY_SHAPE@abilities.0.modifiers']],
  ['a condition list with no conditions', withWhen(), ['ABILITY_SHAPE@abilities.0.when']],
  ['an if step with no conditions', ev([{ do: 'if', when: [], then: [draw1] }]), ['ABILITY_SHAPE@effect.0.when']],
  ['choose with upTo false', ev([{ do: 'choose', as: 'a', count: 1, upTo: false, what: { side: 'you' } }]), ['ABILITY_SHAPE@effect.0.upTo']],
  ['salvage with upTo "yes"', ev([{ do: 'salvage', count: 1, upTo: 'yes' }]), ['ABILITY_SHAPE@effect.0.upTo']],
  ['lookTop with upTo 1', ev([{ do: 'lookTop', count: 3, upTo: 1, rest: 'top' }]), ['ABILITY_SHAPE@effect.0.upTo']],
  ['a look take with upTo false', ev([{ do: 'lookTop', count: 3, take: { count: 1, upTo: false, to: 'hand' }, rest: 'top' }]), ['ABILITY_SHAPE@effect.0.take.upTo']],
  ['an "all" target selector with a card kind', ev([{ do: 'power', amount: 1000, target: { all: { side: 'you', kind: 'character' } } }]), ['ABILITY_SHAPE@effect.0.target.all.kind']],
];

const KIND_CASES: readonly Case[] = [
  ['an ability with no kind', ch([{ trigger: { on: 'play' }, effect: [draw1] }]), ['ABILITY_KIND@abilities.0.kind']],
  ['an ability that is a string', ch(['draw']), ['ABILITY_KIND@abilities.0.kind']],
  ['an ability that is null', ch([null]), ['ABILITY_KIND@abilities.0.kind']],
  ['an ability with two kinds', ch([{ kind: ['automatic', 'continuous'], trigger: { on: 'play' }, effect: [draw1] }]), ['ABILITY_KIND@abilities.0.kind']],
  ['an activated ability on a climax', cx([actv([stock1])]), ['ABILITY_KIND@abilities.0']],
  ['abilities on an event card', { kind: 'event', abilities: [auto([draw1])] }, ['ABILITY_KIND@abilities']],
  ['an activated ability on an event card is reported twice', { kind: 'event', abilities: [actv([stock1])] }, ['ABILITY_KIND@abilities', 'ABILITY_KIND@abilities.0']],
  ['an effect on a character', { kind: 'character', effect: [draw1] }, ['ABILITY_KIND@effect']],
  ['an effect on a climax', { kind: 'climax', effect: [draw1] }, ['ABILITY_KIND@effect']],
];

const TRIGGER_CASES: readonly Case[] = [
  ['a trigger that is a string', ch([{ kind: 'automatic', trigger: 'play', effect: [draw1] }]), ['ABILITY_TRIGGER@abilities.0.trigger.on']],
  ['a trigger with no "on"', ch([{ kind: 'automatic', trigger: {}, effect: [draw1] }]), ['ABILITY_TRIGGER@abilities.0.trigger.on']],
  ['an attack trigger on a climax', cx([{ kind: 'automatic', trigger: { on: 'attack' }, effect: [draw1] }]), ['ABILITY_TRIGGER@abilities.0.trigger.on']],
  ['a reversed trigger on a climax', cx([{ kind: 'automatic', trigger: { on: 'reversed' }, effect: [draw1] }]), ['ABILITY_TRIGGER@abilities.0.trigger.on']],
  ['a climaxPlayed trigger on a climax', cx([{ kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [draw1] }]), ['ABILITY_TRIGGER@abilities.0.trigger.on']],
];

const TIMING_CASES: readonly Case[] = [
  ['timing in the wrong case', ch([{ ...actv([stock1]), timing: 'MAIN' }]), ['ABILITY_TIMING@abilities.0.timing']],
  ['timing "encore"', ch([{ ...actv([stock1]), timing: 'encore' }]), ['ABILITY_TIMING@abilities.0.timing']],
  ['timing that is a number', ch([{ ...actv([stock1]), timing: 1 }]), ['ABILITY_TIMING@abilities.0.timing']],
  ['timing missing (a shape problem, not a timing one)', ch([{ kind: 'activated', cost: [stock1], effect: [draw1] }]), ['ABILITY_SHAPE@abilities.0.timing']],
];

const COST_CASES: readonly Case[] = [
  ['a cost part that is a number', ch([actv([5])]), ['ABILITY_COST@abilities.0.cost.0.pay']],
  ['two discard parts', ch([actv([{ pay: 'discard', count: 1 }, { pay: 'discard', count: 1 }])]), ['ABILITY_COST@abilities.0.cost']],
  ['a climax that rests itself', cx([auto([draw1], { cost: [{ pay: 'rest' }] })]), ['ABILITY_COST@abilities.0.cost.0']],
  ['an optional cost of an unknown kind', ch([auto([draw1], { cost: [{ pay: 'clock' }] })]), ['ABILITY_COST@abilities.0.cost.0.pay']],
];

const STEP_CASES: readonly Case[] = [
  ['a step that is a string', ev(['draw']), ['ABILITY_STEP@effect.0.do']],
  ['a step with no "do"', ev([{ count: 1 }]), ['ABILITY_STEP@effect.0.do']],
  ['an unknown duration', ev([{ do: 'power', amount: 1000, target: { all: { side: 'you' } }, duration: 'forever' }]), ['ABILITY_STEP@effect.0.duration']],
  ['lookTop rest going to the hand', ev([{ do: 'lookTop', count: 3, rest: 'hand' }]), ['ABILITY_STEP@effect.0.rest']],
  ['lookTop taking cards into the clock', ev([{ do: 'lookTop', count: 3, take: { count: 1, to: 'clock' }, rest: 'top' }]), ['ABILITY_STEP@effect.0.take.to']],
  ['may with two optional steps', ev([{ do: 'may', steps: [draw1, draw1] }]), ['ABILITY_STEP@effect.0.steps']],
  ['may wrapping another may', ev([{ do: 'may', steps: [{ do: 'may', steps: [draw1] }] }]), ['ABILITY_STEP@effect.0.steps.0']],
  ['may wrapping an if', ev([{ do: 'may', steps: [{ do: 'if', when: [turnYou], then: [draw1] }] }]), ['ABILITY_STEP@effect.0.steps.0']],
  ['may wrapping an "up to" step', ev([{ do: 'may', steps: [{ do: 'draw', count: 2, upTo: true }] }]), ['ABILITY_STEP@effect.0.steps.0']],
  ['may with no optional step', ev([{ do: 'may', steps: [] }]), ['ABILITY_STEP@effect.0.steps', 'ABILITY_SHAPE@effect.0.steps']],
  ['a modifier on a stat other than power or soul', withMods({ stat: 'level', amount: 1, target: 'this' }), ['ABILITY_STEP@abilities.0.modifiers.0.stat']],
];

const RANGE_CASES: readonly Case[] = [
  ['draw 0', ev([{ do: 'draw', count: 0 }]), ['ABILITY_RANGE@effect.0.count']],
  ['draw 6 (above the count limit of 5)', ev([{ do: 'draw', count: 6 }]), ['ABILITY_RANGE@effect.0.count']],
  ['draw -1', ev([{ do: 'draw', count: -1 }]), ['ABILITY_RANGE@effect.0.count']],
  ['draw 1.5', ev([{ do: 'draw', count: 1.5 }]), ['ABILITY_RANGE@effect.0.count']],
  ['draw "1" (a string)', ev([{ do: 'draw', count: '1' }]), ['ABILITY_RANGE@effect.0.count']],
  ['draw NaN', ev([{ do: 'draw', count: NaN }]), ['ABILITY_RANGE@effect.0.count']],
  ['choose 0 characters', ev([{ do: 'choose', as: 'a', count: 0, what: { side: 'you' } }]), ['ABILITY_RANGE@effect.0.count']],
  ['power 0', ev([{ do: 'power', amount: 0, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['power +20001', ev([{ do: 'power', amount: 20001, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['power -20001', ev([{ do: 'power', amount: -20001, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['soul +4', ev([{ do: 'soul', amount: 4, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['soul -4', ev([{ do: 'soul', amount: -4, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['damage 0', ev([{ do: 'damageOpp', amount: 0 }]), ['ABILITY_RANGE@effect.0.amount']],
  ['damage 6', ev([{ do: 'damageOpp', amount: 6 }]), ['ABILITY_RANGE@effect.0.amount']],
  ['look at 11 cards', ev([{ do: 'lookTop', count: 11, rest: 'top' }]), ['ABILITY_RANGE@effect.0.count']],
  ['take more cards than were looked at', ev([{ do: 'lookTop', count: 3, take: { count: 4, to: 'hand' }, rest: 'top' }]), ['ABILITY_RANGE@effect.0.take.count']],
  ['a stock cost of 6', ch([actv([{ pay: 'stock', count: 6 }])]), ['ABILITY_RANGE@abilities.0.cost.0.count']],
  ['a modifier of 0', withMods({ stat: 'power', amount: 0, target: 'this' }), ['ABILITY_RANGE@abilities.0.modifiers.0.amount']],
  ['a modifier of +4 soul', withMods({ stat: 'soul', amount: 4, target: 'this' }), ['ABILITY_RANGE@abilities.0.modifiers.0.amount']],
  ['a condition bound of 100', withWhen({ if: 'level', min: 100 }), ['ABILITY_RANGE@abilities.0.when.0.min']],
  ['a condition bound of -1', withWhen({ if: 'count', what: { side: 'you' }, max: -1 }), ['ABILITY_RANGE@abilities.0.when.0.max']],
  ['a discard cost of 0 cards', ch([actv([{ pay: 'discard', count: 0 }])]), ['ABILITY_RANGE@abilities.0.cost.0.count']],
  ['a discard cost of 6 cards', ch([actv([{ pay: 'discard', count: 6 }])]), ['ABILITY_RANGE@abilities.0.cost.0.count']],
  ['choose 6 characters', ev([{ do: 'choose', as: 'a', count: 6, what: { side: 'you' } }]), ['ABILITY_RANGE@effect.0.count']],
  ['discard 6 cards', ev([{ do: 'discard', count: 6 }]), ['ABILITY_RANGE@effect.0.count']],
  ['salvage 6 cards', ev([{ do: 'salvage', count: 6 }]), ['ABILITY_RANGE@effect.0.count']],
  ['put 6 cards from the deck into stock', ev([{ do: 'stockFromDeck', count: 6 }]), ['ABILITY_RANGE@effect.0.count']],
  ['take 0 of the looked-at cards', ev([{ do: 'lookTop', count: 3, take: { count: 0, to: 'hand' }, rest: 'top' }]), ['ABILITY_RANGE@effect.0.take.count']],
  ['power +500.5', ev([{ do: 'power', amount: 500.5, target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
  ['power "1000" (a string)', ev([{ do: 'power', amount: '1000', target: { all: { side: 'you' } } }]), ['ABILITY_RANGE@effect.0.amount']],
];

const FILTER_CASES: readonly Case[] = [
  ['a filter level above 3', ev([{ do: 'salvage', count: 1, filter: { level: { min: 4 } } }]), ['ABILITY_FILTER@effect.0.filter.level.min']],
  ['a filter level below 0', ev([{ do: 'salvage', count: 1, filter: { level: { max: -1 } } }]), ['ABILITY_FILTER@effect.0.filter.level.max']],
  ['a filter level with neither bound', ev([{ do: 'salvage', count: 1, filter: { level: {} } }]), ['ABILITY_FILTER@effect.0.filter.level']],
  ['a filter level whose min is above its max', ev([{ do: 'salvage', count: 1, filter: { level: { min: 2, max: 1 } } }]), ['ABILITY_FILTER@effect.0.filter.level']],
  ['an unknown card kind', ev([{ do: 'salvage', count: 1, filter: { kind: 'token' } }]), ['ABILITY_FILTER@effect.0.filter.kind']],
  ['an empty name', ev([{ do: 'salvage', count: 1, filter: { name: '' } }]), ['ABILITY_FILTER@effect.0.filter.name']],
  ['a blank name', ev([{ do: 'salvage', count: 1, filter: { name: '   ' } }]), ['ABILITY_FILTER@effect.0.filter.name']],
  ['a name of 41 characters', ev([{ do: 'salvage', count: 1, filter: { name: chars(41) } }]), ['ABILITY_FILTER@effect.0.filter.name']],
  ['a trait of 41 characters', ev([{ do: 'salvage', count: 1, filter: { trait: chars(41) } }]), ['ABILITY_FILTER@effect.0.filter.trait']],
  ['a trait that is a list', ev([{ do: 'salvage', count: 1, filter: { trait: ['Squad'] } }]), ['ABILITY_FILTER@effect.0.filter.trait']],
  ['a selector side of "both"', ev([{ do: 'choose', as: 'a', count: 1, what: { side: 'both' } }]), ['ABILITY_FILTER@effect.0.what.side']],
  ['a selector role of "blocker"', ev([{ do: 'choose', as: 'a', count: 1, what: { side: 'you', role: 'blocker' } }]), ['ABILITY_FILTER@effect.0.what.role']],
  ['"other" on an event (it has no characters of its own)', ev([{ do: 'choose', as: 'a', count: 1, what: { side: 'you', other: true } }]), ['ABILITY_FILTER@effect.0.what.other']],
  ['"other" on a climax', cx([{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: { side: 'you', other: true } }] }]), ['ABILITY_FILTER@abilities.0.modifiers.0.target.other']],
  ['counting a zone the language does not know', withWhen({ if: 'count', what: { side: 'you', zone: 'deck' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what.zone']],
  ['counting hand cards by trait (would reveal them)', withWhen({ if: 'count', what: { side: 'opponent', zone: 'hand', trait: 'Squad' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what']],
  ['counting hand cards by card kind (would reveal them)', withWhen({ if: 'count', what: { side: 'you', zone: 'hand', kind: 'climax' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what']],
  ['counting stock cards by color (would reveal them)', withWhen({ if: 'count', what: { side: 'you', zone: 'stock', color: 'red' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what']],
  ['an empty climax name in a trigger', ch([{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: '' }, effect: [draw1] }]), ['ABILITY_FILTER@abilities.0.trigger.name']],
  ['a climax condition name of 41 characters', withWhen({ if: 'climax', name: chars(41) }), ['ABILITY_FILTER@abilities.0.when.0.name']],
  ['a level condition with side "both"', withWhen({ if: 'level', side: 'both', min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.side']],
  ['a climax condition with side "both"', withWhen({ if: 'climax', side: 'both' }), ['ABILITY_FILTER@abilities.0.when.0.side']],
  ['a turn condition with side "mine"', withWhen({ if: 'turn', side: 'mine' }), ['ABILITY_FILTER@abilities.0.when.0.side']],
  ['a count condition with side "both"', withWhen({ if: 'count', what: { side: 'both' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what.side']],
  ['a count condition filtered by an unknown color', withWhen({ if: 'count', what: { side: 'you', zone: 'waiting', color: 'purple' }, min: 1 }), ['ABILITY_FILTER@abilities.0.when.0.what.color']],
  ['a discard cost filtered by an unknown card kind', ch([actv([{ pay: 'discard', count: 1, filter: { kind: 'token' } }])]), ['ABILITY_FILTER@abilities.0.cost.0.filter.kind']],
  ['a discard step filtered by a level above 3', ev([{ do: 'discard', count: 1, filter: { level: { min: 4 } } }]), ['ABILITY_FILTER@effect.0.filter.level.min']],
  ['a look take filtered by an unknown color', ev([{ do: 'lookTop', count: 3, take: { count: 1, filter: { color: 'purple' }, to: 'hand' }, rest: 'top' }]), ['ABILITY_FILTER@effect.0.take.filter.color']],
  ['an "all" target selector with side "both"', ev([{ do: 'sendToWaiting', target: { all: { side: 'both' } } }]), ['ABILITY_FILTER@effect.0.target.all.side']],
  ['a modifier selector with an empty trait', withMods({ stat: 'power', amount: 500, target: { side: 'you', trait: '' } }), ['ABILITY_FILTER@abilities.0.modifiers.0.target.trait']],
];

const CONDITION_CASES: readonly Case[] = [
  ['an unknown condition', withWhen({ if: 'phase', side: 'you' }), ['ABILITY_CONDITION@abilities.0.when.0.if']],
  ['a condition that is a string', withWhen('turn'), ['ABILITY_CONDITION@abilities.0.when.0.if']],
  ['a level condition with neither bound', withWhen({ if: 'level', side: 'you' }), ['ABILITY_CONDITION@abilities.0.when.0']],
  ['a count condition whose min is above its max', withWhen({ if: 'count', what: { side: 'you' }, min: 3, max: 2 }), ['ABILITY_CONDITION@abilities.0.when.0']],
  ['a bad condition inside an if step', ev([{ do: 'if', when: [{ if: 'level' }], then: [draw1] }]), ['ABILITY_CONDITION@effect.0.when.0']],
  ['a bad condition on an activated ability', ch([actv([stock1], [draw1], { when: [{ if: 'weather' }] })]), ['ABILITY_CONDITION@abilities.0.when.0.if']],
];

const TARGET_CASES: readonly Case[] = [
  ['a target that is an unknown word', ev([{ do: 'power', amount: 1000, target: 'self' }]), ['ABILITY_TARGET@effect.0.target']],
  ['a target that is an empty object', ev([{ do: 'returnToHand', target: {} }]), ['ABILITY_TARGET@effect.0.target']],
  ['a target that is null', ev([{ do: 'sendToWaiting', target: null }]), ['ABILITY_TARGET@effect.0.target']],
  ['"this" in an event effect', ev([{ do: 'power', amount: 1000, target: 'this' }]), ['ABILITY_TARGET@effect.0.target']],
  ['"this" in a climax ability', cx([auto([{ do: 'soul', amount: 1, target: 'this' }])]), ['ABILITY_TARGET@abilities.0.effect.0.target']],
  ['a climax modifier on "this"', cx([{ kind: 'continuous', modifiers: [plus500] }]), ['ABILITY_TARGET@abilities.0.modifiers.0.target']],
];

const choose = (as: unknown, count = 1) => ({ do: 'choose', as, count, what: { side: 'opponent' } });
const hit = (ref: unknown) => ({ do: 'power', amount: -1000, target: { ref } });

const REF_CASES: readonly Case[] = [
  ['a choose name with a capital letter', ev([choose('Foe')]), ['ABILITY_REF@effect.0.as']],
  ['a choose name starting with a digit', ev([choose('1a')]), ['ABILITY_REF@effect.0.as']],
  ['a choose name with a dash', ev([choose('a-b')]), ['ABILITY_REF@effect.0.as']],
  ['an empty choose name', ev([choose('')]), ['ABILITY_REF@effect.0.as']],
  ['a choose name of 13 characters', ev([choose('abcdefghijklm')]), ['ABILITY_REF@effect.0.as']],
  ['a choose name that is a number', ev([choose(7)]), ['ABILITY_REF@effect.0.as']],
  ['the same name chosen twice in one list', ev([choose('a'), choose('a')]), ['ABILITY_REF@effect.1.as']],
  ['a name chosen again inside a branch that can see the first', ev([choose('a'), { do: 'if', when: [turnYou], then: [choose('a')] }]), ['ABILITY_REF@effect.1.then.0.as']],
  ['a ref to a name that is never chosen', ev([hit('ghost')]), ['ABILITY_REF@effect.0.target.ref']],
  ['a ref before its choose', ev([hit('a'), choose('a')]), ['ABILITY_REF@effect.0.target.ref']],
  ['a ref that is not a string', ev([choose('a'), hit(1)]), ['ABILITY_REF@effect.1.target.ref']],
  ['a ref after the if branch that chose it', ev([{ do: 'if', when: [turnYou], then: [choose('a')] }, hit('a')]), ['ABILITY_REF@effect.1.target.ref']],
  ['a ref in the else branch to a name chosen in the then branch', ev([{ do: 'if', when: [turnYou], then: [choose('a'), hit('a')], else: [hit('a')] }]), ['ABILITY_REF@effect.0.else.0.target.ref']],
  ['"if you do not" referring to what the optional action chose', ev([{ do: 'may', steps: [choose('a')], else: [hit('a')] }]), ['ABILITY_REF@effect.0.else.0.target.ref']],
  ['a ref to a name chosen by another ability on the card', ch([auto([choose('a')]), auto([hit('a')])]), ['ABILITY_REF@abilities.1.effect.0.target.ref']],
];

/** n nested if steps: the innermost `then` list sits at depth n + 1. */
function nestedIfs(n: number): unknown[] {
  let list: unknown[] = [draw1];
  for (let i = 0; i < n; i++) list = [{ do: 'if', when: [turnYou], then: list }];
  return list;
}

const LIMIT_CASES: readonly Case[] = [
  ['five abilities', ch(repeat(5, cont())), ['ABILITY_LIMIT@abilities']],
  ['nine steps in an effect', ev(repeat(9, draw1)), ['ABILITY_LIMIT@effect']],
  ['nine steps in a nested then', ev([{ do: 'if', when: [turnYou], then: repeat(9, draw1) }]), ['ABILITY_LIMIT@effect.0.then']],
  ['nine cost parts', ch([actv(repeat(9, stock1))]), ['ABILITY_LIMIT@abilities.0.cost']],
  ['nine conditions', withWhen(...repeat(9, turnYou)), ['ABILITY_LIMIT@abilities.0.when']],
  ['nine modifiers', withMods(...repeat(9, plus500)), ['ABILITY_LIMIT@abilities.0.modifiers']],
  ['steps nested four deep', ev(nestedIfs(3)), ['ABILITY_LIMIT@effect.0.then.0.then.0.then']],
  ['steps nested four deep inside an activated ability', ch([actv([stock1], nestedIfs(3))]), ['ABILITY_LIMIT@abilities.0.effect.0.then.0.then.0.then']],
  [
    'steps nested four deep through may and its "if you do"',
    ev([{ do: 'may', steps: [draw1], then: [{ do: 'may', steps: [draw1], then: [{ do: 'may', steps: [draw1] }] }] }]),
    ['ABILITY_LIMIT@effect.0.then.0.then.0.steps'],
  ],
  ['steps nested four deep inside an automatic ability', ch([auto(nestedIfs(3))]), ['ABILITY_LIMIT@abilities.0.effect.0.then.0.then.0.then']],
  [
    'steps nested four deep through may and its "if you do not"',
    ev([{ do: 'may', steps: [draw1], else: [{ do: 'may', steps: [draw1], else: [{ do: 'may', steps: [draw1] }] }] }]),
    ['ABILITY_LIMIT@effect.0.else.0.else.0.steps'],
  ],
  [
    'steps nested four deep through if and its "otherwise"',
    ev([{ do: 'if', when: [turnYou], then: [draw1], else: [{ do: 'if', when: [turnYou], then: [draw1], else: [{ do: 'may', steps: [draw1] }] }] }]),
    ['ABILITY_LIMIT@effect.0.else.0.else.0.steps'],
  ],
];

describe('ability checker: more bad cards for each code (exact problems and paths)', () => {
  it.each(SHAPE_CASES)('ABILITY_SHAPE: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(KIND_CASES)('ABILITY_KIND: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(TRIGGER_CASES)('ABILITY_TRIGGER: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(TIMING_CASES)('ABILITY_TIMING: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(COST_CASES)('ABILITY_COST: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(STEP_CASES)('ABILITY_STEP: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(RANGE_CASES)('ABILITY_RANGE: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(FILTER_CASES)('ABILITY_FILTER: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(CONDITION_CASES)('ABILITY_CONDITION: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(TARGET_CASES)('ABILITY_TARGET: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(REF_CASES)('ABILITY_REF: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
  it.each(LIMIT_CASES)('ABILITY_LIMIT: %s', (_why, def, expected) => expect(problems(def)).toEqual(expected));
});

// =============================================================================
// Limits: the last allowed value passes, the next one fails
// =============================================================================

describe('ability checker: size and depth limits at their boundaries', () => {
  it('four abilities pass, five fail', () => {
    expect(problems(ch(repeat(4, cont())))).toEqual([]);
    expect(problems(ch(repeat(5, cont())))).toEqual(['ABILITY_LIMIT@abilities']);
  });

  it('eight steps, cost parts, conditions and modifiers pass; nine fail', () => {
    expect(problems(ev(repeat(8, draw1)))).toEqual([]);
    expect(problems(ch([actv(repeat(8, stock1))]))).toEqual([]);
    expect(problems(withWhen(...repeat(8, turnYou)))).toEqual([]);
    expect(problems(withMods(...repeat(8, plus500)))).toEqual([]);
    expect(problems(ev(repeat(9, draw1)))).toEqual(['ABILITY_LIMIT@effect']);
  });

  it('steps nested three deep pass; four deep fail', () => {
    expect(problems(ev(nestedIfs(2)))).toEqual([]);
    expect(problems(ev(nestedIfs(3)))).toEqual(['ABILITY_LIMIT@effect.0.then.0.then.0.then']);
  });

  it('numbers pass at their largest allowed size and fail one above it', () => {
    const all = { all: { side: 'you' } };
    expect(problems(ev([{ do: 'draw', count: 5 }, { do: 'heal', count: 5 }, { do: 'stockFromDeck', count: 5 }, { do: 'salvage', count: 5 }]))).toEqual([]);
    expect(problems(ev([{ do: 'power', amount: 20000, target: all }, { do: 'power', amount: -20000, target: all }]))).toEqual([]);
    expect(problems(ev([{ do: 'soul', amount: 3, target: all }, { do: 'soul', amount: -3, target: all }]))).toEqual([]);
    expect(problems(ev([{ do: 'damageOpp', amount: 5 }]))).toEqual([]);
    expect(problems(ev([{ do: 'lookTop', count: 10, take: { count: 10, to: 'hand' }, rest: 'top' }]))).toEqual([]);
    expect(problems(ev([{ do: 'heal', count: 6 }]))).toEqual(['ABILITY_RANGE@effect.0.count']);
    expect(problems(ev([{ do: 'lookTop', count: 10, take: { count: 11, to: 'hand' }, rest: 'top' }]))).toEqual(['ABILITY_RANGE@effect.0.take.count']);
    expect(problems(withWhen({ if: 'level', min: 0, max: 99 }))).toEqual([]);
  });

  it('names of 40 characters and choose names of 12 pass; 41 and 13 fail', () => {
    expect(problems(ev([{ do: 'salvage', count: 1, filter: { name: chars(40), trait: chars(40) } }]))).toEqual([]);
    expect(problems(ch([{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: chars(40) }, effect: [draw1] }]))).toEqual([]);
    expect(problems(ev([choose('abcdefghijkl'), hit('abcdefghijkl'), choose('a'), hit('a')]))).toEqual([]);
    expect(problems(ev([{ do: 'salvage', count: 1, filter: { name: chars(41) } }]))).toEqual(['ABILITY_FILTER@effect.0.filter.name']);
    expect(problems(ev([choose('abcdefghijklm')]))).toEqual(['ABILITY_REF@effect.0.as']);
  });

  it('caps a list before looking inside it: nine broken steps give one limit problem, not nine step problems', () => {
    expect(problems(ev(repeat(9, { do: 'nope' })))).toEqual(['ABILITY_LIMIT@effect']);
    expect(problems(ch(repeat(100_000, { kind: 'nope' })))).toEqual(['ABILITY_LIMIT@abilities']);
  });

  it('stops at the depth limit, so deeply nested and even self-containing data is checked in bounded work', () => {
    expect(problems(ev(nestedIfs(60)))).toEqual(['ABILITY_LIMIT@effect.0.then.0.then.0.then']);

    const loop: { do: string; when: unknown[]; then: unknown[] } = { do: 'if', when: [turnYou], then: [] };
    loop.then.push(loop);
    expect(problems(ev([loop]))).toEqual(['ABILITY_LIMIT@effect.0.then.0.then.0.then']);
  });
});

// =============================================================================
// Odd and hostile input
// =============================================================================

describe('ability checker: odd and hostile input', () => {
  it('never throws on junk in either field, and always answers with an error list', () => {
    const junk: unknown[] = [null, 0, -1, 'draw', true, {}, [], [null], [[]], [{}], [{ do: null }], [{ kind: {} }], [() => 1], [Symbol('x')], new Map(), [new Date(0)], [Object.create(null)]];
    for (const kind of ['character', 'event', 'climax', 'token', '']) {
      for (const value of junk) {
        expect(() => checkCardAbilities({ kind, abilities: value }, 'card J')).not.toThrow();
        expect(() => checkCardAbilities({ kind, effect: value }, 'card J')).not.toThrow();
        expect(Array.isArray(checkCardAbilities({ kind, abilities: value, effect: value }, 'card J'))).toBe(true);
      }
    }
  });

  it('a list with an empty slot is a shape problem, not a crash', () => {
    const holey: unknown[] = [];
    holey[1] = cont();
    expect(problems(ch(holey))).toEqual(['ABILITY_SHAPE@abilities']);
  });

  it('a "__proto__" key from a JSON file is an unknown field, not a prototype change', () => {
    const fromJson: unknown = JSON.parse('[{"kind":"continuous","modifiers":[{"stat":"power","amount":500,"target":"this"}],"__proto__":{"kind":"activated"}}]');
    expect(problems(ch(fromJson))).toEqual(['ABILITY_SHAPE@abilities.0.__proto__']);
  });

  it('objects with no prototype are read like plain objects', () => {
    const bare = Object.assign(Object.create(null) as object, { do: 'draw', count: 1 });
    expect(problems(ev([bare]))).toEqual([]);
    const badBare = Object.assign(Object.create(null) as object, { do: 'draw', count: 0 });
    expect(problems(ev([badBare]))).toEqual(['ABILITY_RANGE@effect.0.count']);
  });

  it('a card with neither field has no ability problems', () => {
    for (const kind of ['character', 'event', 'climax']) expect(problems({ kind })).toEqual([]);
  });
});

// =============================================================================
// Valid cards: the whole language, at its limits, with no problems
// =============================================================================

const NAME40 = 'Lighthouse Keeper of the Northern Shoals';
const VALID: CardDef[] = [
  unit('VA-FOUR', 'Quad Sentinel', [
    {
      kind: 'activated',
      timing: 'main',
      cost: [{ pay: 'stock', count: 5 }, { pay: 'discard', count: 5, filter: { kind: 'character', level: { min: 0, max: 3 } } }, { pay: 'rest' }, { pay: 'selfToWaiting' }],
      when: [
        { if: 'level', min: 0 },
        { if: 'level', side: 'opponent', max: 99 },
        { if: 'level', side: 'you', min: 2, max: 2 },
        { if: 'climax' },
        { if: 'climax', side: 'opponent', name: NAME40 },
        { if: 'count', what: { side: 'you' }, min: 1 },
        { if: 'count', what: { side: 'opponent', zone: 'hand' }, max: 7 },
        { if: 'turn', side: 'you' },
      ],
      effect: [{ do: 'draw', count: 5, upTo: true }],
    },
    { kind: 'activated', timing: 'counter', cost: [{ pay: 'stock', count: 1 }], effect: [{ do: 'power', amount: 20000, target: 'this' }, { do: 'soul', amount: -3, target: 'this', duration: 'game' }] },
    { kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Ember Gate' }, cost: [{ pay: 'stock', count: 1 }, { pay: 'rest' }], effect: [{ do: 'stockFromDeck', count: 5 }] },
    {
      kind: 'continuous',
      when: [{ if: 'turn', side: 'opponent' }],
      modifiers: [
        { stat: 'power', amount: 20000, target: 'this' },
        { stat: 'power', amount: -20000, target: 'this' },
        { stat: 'soul', amount: 3, target: 'this' },
        { stat: 'soul', amount: -3, target: 'this' },
        { stat: 'power', amount: 500, target: { side: 'you', other: true } },
        { stat: 'soul', amount: 1, target: { side: 'opponent', role: 'defender' } },
        { stat: 'power', amount: 1000, target: { side: 'you', role: 'attacker', name: 'Yellow Scout' } },
        { stat: 'power', amount: -500, target: { side: 'opponent', trait: 'Squad', color: 'red', level: { max: 1 } } },
      ],
    },
  ]),
  unit('VA-TRIG', 'Alarm Post', [
    { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'draw', count: 1 }] },
    { kind: 'automatic', trigger: { on: 'attack' }, effect: [{ do: 'soul', amount: 1, target: 'this', duration: 'turn' }] },
    { kind: 'automatic', trigger: { on: 'reversed' }, effect: [{ do: 'sendToWaiting', target: { all: { side: 'opponent', role: 'attacker' } } }] },
    { kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [{ do: 'heal', count: 1 }] },
  ]),
  unit('VA-EIGHT', 'Eightfold Clerk', [
    {
      kind: 'automatic',
      trigger: { on: 'play' },
      effect: [
        { do: 'draw', count: 1, player: 'opponent' },
        { do: 'discard', count: 1, upTo: true, filter: { trait: 'Squad' }, player: 'opponent' },
        { do: 'discard', count: 2 },
        { do: 'stockFromDeck', count: 1 },
        { do: 'heal', count: 5 },
        { do: 'damageOpp', amount: 5 },
        { do: 'salvage', count: 5, upTo: true, filter: { kind: 'climax' } },
        { do: 'lookTop', count: 10, upTo: true, take: { count: 10, upTo: true, filter: { color: 'blue' }, to: 'stock' }, rest: 'waiting' },
      ],
    },
  ]),
  unit('VA-DEEP', 'Layered Tactician', [
    {
      kind: 'automatic',
      trigger: { on: 'attack' },
      effect: [
        {
          do: 'if',
          when: [{ if: 'turn', side: 'you' }],
          then: [
            {
              do: 'may',
              steps: [{ do: 'choose', as: 'abcdefghijkl', count: 1, what: { side: 'opponent' } }],
              then: [
                { do: 'power', amount: -1000, target: { ref: 'abcdefghijkl' } },
                { do: 'returnToHand', target: { ref: 'abcdefghijkl' } },
              ],
              else: [{ do: 'sendToWaiting', target: 'this' }],
            },
          ],
          else: [{ do: 'if', when: [{ if: 'level', max: 1 }], then: [{ do: 'soul', amount: 1, target: 'this' }] }],
        },
      ],
    },
  ]),
  eventCard('VA-REFS', 'Scoped Orders', [
    { do: 'choose', as: 'a', count: 2, upTo: true, what: { side: 'you' } },
    {
      do: 'if',
      when: [{ if: 'count', what: { side: 'you', zone: 'waiting', kind: 'event', color: 'yellow', name: 'Quick Dispatch' }, min: 1 }],
      // The outer name is visible in both branches; each branch chooses under its own name (names are unique per ability).
      then: [{ do: 'power', amount: 1000, target: { ref: 'a' } }, { do: 'choose', as: 'b', count: 1, what: { side: 'opponent' } }, { do: 'soul', amount: -1, target: { ref: 'b' } }],
      else: [{ do: 'choose', as: 'c', count: 1, what: { side: 'opponent' } }, { do: 'returnToHand', target: { ref: 'c' } }],
    },
    { do: 'sendToWaiting', target: { ref: 'a' } },
  ]),
  eventCard('VA-LOOK', 'Triple Survey', [
    { do: 'lookTop', count: 3, rest: 'top' },
    { do: 'lookTop', count: 1, take: { count: 1, to: 'waiting' }, rest: 'bottom' },
    { do: 'lookTop', count: 2, take: { count: 1, to: 'hand' }, rest: 'waiting' },
  ]),
  climaxCard('VA-CX', 'Rally Beacon', [
    { kind: 'continuous', when: [{ if: 'climax' }], modifiers: [{ stat: 'soul', amount: 1, target: { side: 'you' } }] },
    {
      kind: 'automatic',
      trigger: { on: 'play' },
      cost: [{ pay: 'stock', count: 1 }, { pay: 'discard', count: 1 }, { pay: 'selfToWaiting' }],
      effect: [{ do: 'draw', count: 1 }, { do: 'power', amount: 1000, target: { all: { side: 'you' } } }, { do: 'returnToHand', target: { all: { side: 'opponent', role: 'attacker' } } }],
    },
  ]),
  unit('VA-ZONES', 'Census Taker', [
    {
      kind: 'continuous',
      when: [
        { if: 'count', what: { side: 'you', zone: 'stage', trait: 'Squad' }, min: 1 },
        { if: 'count', what: { side: 'you', zone: 'climax', name: 'Yellow Dawn' }, min: 1 },
        { if: 'count', what: { side: 'you', zone: 'hand' }, min: 1 },
        { if: 'count', what: { side: 'opponent', zone: 'waiting', kind: 'climax' }, min: 1 },
        { if: 'count', what: { side: 'you', zone: 'clock', color: 'red' }, max: 6 },
        { if: 'count', what: { side: 'you', zone: 'level', level: { min: 1 } }, min: 0 },
        { if: 'count', what: { side: 'opponent', zone: 'stock' }, min: 2, max: 3 },
      ],
      modifiers: [{ stat: 'power', amount: 1500, target: 'this' }],
    },
  ]),
];

describe('ability checker: valid cards have no problems', () => {
  it.each(VALID.map((d) => [d.id, d] as const))('%s', (_id, def) => {
    expect(checkCardAbilities(def, `card ${def.id}`)).toEqual([]);
  });

  it('the valid cards pass validateCatalog together with the shared test catalog', () => {
    expect(NAME40).toHaveLength(ABILITY_LIMITS.text);
    expect(validateCatalog({ ...catalog, ...byId(VALID) })).toEqual([]);
  });

  it('the valid cards use every step kind, cost kind, condition kind, trigger, timing, count zone and target form', () => {
    const seen = new Set<string>();
    const visit = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(visit);
      else if (typeof x === 'object' && x !== null) {
        const o = x as Record<string, unknown>;
        for (const key of ['do', 'pay', 'if', 'on', 'timing', 'zone', 'kind', 'rest', 'to', 'role', 'duration']) {
          if (typeof o[key] === 'string') seen.add(`${key}:${o[key]}`);
        }
        if (o.target === 'this') seen.add('target:this');
        if (typeof o.target === 'object' && o.target !== null) seen.add(`target:${Object.keys(o.target).join()}`);
        Object.values(o).forEach(visit);
      }
    };
    visit(VALID);
    const want = [
      ...['choose', 'draw', 'discard', 'stockFromDeck', 'heal', 'power', 'soul', 'damageOpp', 'salvage', 'lookTop', 'sendToWaiting', 'returnToHand', 'may', 'if'].map((k) => `do:${k}`),
      ...['stock', 'discard', 'rest', 'selfToWaiting'].map((k) => `pay:${k}`),
      ...['level', 'climax', 'count', 'turn'].map((k) => `if:${k}`),
      ...['play', 'attack', 'reversed', 'climaxPlayed'].map((k) => `on:${k}`),
      'timing:main',
      'timing:counter',
      ...COUNT_ZONES.map((z) => `zone:${z}`),
      'rest:top',
      'rest:bottom',
      'rest:waiting',
      'to:hand',
      'to:stock',
      'to:waiting',
      'role:attacker',
      'role:defender',
      'duration:turn',
      'duration:game',
      'target:this',
      'target:ref',
      'target:all',
    ];
    expect(want.filter((w) => !seen.has(w))).toEqual([]);
  });
});

// =============================================================================
// Generated valid cards: the checker accepts them and the renderer handles them
// =============================================================================

type GenKind = 'character' | 'event' | 'climax';

const sideArb = fc.constantFrom<Side>('you', 'opponent');
const intIn = (min: number, max: number) => fc.integer({ min, max });
const maybe = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
/** Adds the key only when the value is present: the checker rejects keys with undefined values. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));
const flag = <K extends string>(key: K, on: boolean): Partial<Record<K, true>> => (on ? ({ [key]: true } as Record<K, true>) : {});

const levelArb = fc.oneof(
  intIn(0, 3).map((min) => ({ min })),
  intIn(0, 3).map((max) => ({ max })),
  fc.tuple(intIn(0, 3), intIn(0, 3)).map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) })),
);
const filterArb: fc.Arbitrary<CardFilter> = fc
  .tuple(
    maybe(fc.constantFrom<CardKind>('character', 'event', 'climax')),
    maybe(fc.constantFrom('Ember Gate', 'Night Lancer')),
    maybe(fc.constantFrom('Squad', 'Night')),
    maybe(fc.constantFrom<Color>(...COLORS)),
    maybe(levelArb),
  )
  .map(([kind, name, trait, color, level]) => ({ ...opt('kind', kind), ...opt('name', name), ...opt('trait', trait), ...opt('color', color), ...opt('level', level) }));

const selectorArb = (kind: GenKind): fc.Arbitrary<Selector> =>
  fc
    .tuple(sideArb, fc.boolean(), maybe(fc.constantFrom<'attacker' | 'defender'>('attacker', 'defender')), filterArb)
    .map(([side, other, role, f]) => {
      const { kind: _kind, ...rest } = f;
      return { side, ...flag('other', other && kind === 'character'), ...opt('role', role), ...rest };
    });

const targetArb = (kind: GenKind): fc.Arbitrary<Target> => {
  const all = selectorArb(kind).map((sel): Target => ({ all: sel }));
  return kind === 'character' ? fc.oneof(fc.constant<Target>('this'), all) : all;
};

const boundsArb = fc.oneof(
  intIn(0, 99).map((min) => ({ min })),
  intIn(0, 99).map((max) => ({ max })),
  fc.tuple(intIn(0, 99), intIn(0, 99)).map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) })),
);

const countSpecArb: fc.Arbitrary<CountSpec> = fc.tuple(sideArb, maybe(fc.constantFrom<CountZone>(...COUNT_ZONES)), filterArb).map(([side, zone, f]) => {
  const hidden = zone === 'hand' || zone === 'stock';
  return { side, ...opt('zone', zone), ...(hidden ? {} : f) };
});

const conditionArb: fc.Arbitrary<Condition> = fc.oneof(
  fc.tuple(maybe(sideArb), boundsArb).map(([side, b]): Condition => ({ if: 'level', ...opt('side', side), ...b })),
  fc.tuple(maybe(sideArb), maybe(fc.constantFrom('Ember Gate', 'Yellow Dawn'))).map(([side, name]): Condition => ({ if: 'climax', ...opt('side', side), ...opt('name', name) })),
  fc.tuple(countSpecArb, boundsArb).map(([what, b]): Condition => ({ if: 'count', what, ...b })),
  sideArb.map((side): Condition => ({ if: 'turn', side })),
);
const conditionsArb = fc.array(conditionArb, { minLength: 1, maxLength: 3 });

const powerArb = intIn(-20000, 20000).filter((n) => n !== 0);
const soulArb = fc.constantFrom(-3, -2, -1, 1, 2, 3);
const durationArb = maybe(fc.constantFrom<'turn' | 'game'>('turn', 'game'));

const lookArb = (allowUpTo: boolean): fc.Arbitrary<Step> =>
  intIn(1, 10).chain((n) =>
    fc
      .tuple(
        fc.boolean(),
        maybe(fc.tuple(intIn(1, n), fc.boolean(), maybe(filterArb), fc.constantFrom<'hand' | 'stock' | 'waiting'>('hand', 'stock', 'waiting'))),
        fc.constantFrom<'top' | 'bottom' | 'waiting'>('top', 'bottom', 'waiting'),
      )
      .map(([upTo, take, rest]): Step => ({
        do: 'lookTop',
        count: n,
        ...flag('upTo', upTo && allowUpTo),
        ...opt('take', take ? { count: take[0], ...flag('upTo', take[1]), ...opt('filter', take[2]), to: take[3] } : undefined),
        rest,
      })),
  );

/** One step with no choose, no ref and no nesting. */
const plainStepArb = (kind: GenKind, allowUpTo: boolean): fc.Arbitrary<Step> =>
  fc.oneof(
    fc.tuple(intIn(1, 5), fc.boolean(), fc.boolean()).map(([count, upTo, opp]): Step => ({ do: 'draw', count, ...flag('upTo', upTo && allowUpTo), ...opt('player', opp ? ('opponent' as const) : undefined) })),
    fc
      .tuple(intIn(1, 5), fc.boolean(), fc.boolean(), maybe(filterArb))
      .map(([count, upTo, opp, filter]): Step => ({ do: 'discard', count, ...flag('upTo', upTo && allowUpTo), ...opt('player', opp ? ('opponent' as const) : undefined), ...opt('filter', filter) })),
    intIn(1, 5).map((count): Step => ({ do: 'stockFromDeck', count })),
    intIn(1, 5).map((count): Step => ({ do: 'heal', count })),
    fc.tuple(powerArb, targetArb(kind), durationArb).map(([amount, target, duration]): Step => ({ do: 'power', amount, target, ...opt('duration', duration) })),
    fc.tuple(soulArb, targetArb(kind), durationArb).map(([amount, target, duration]): Step => ({ do: 'soul', amount, target, ...opt('duration', duration) })),
    intIn(1, 5).map((amount): Step => ({ do: 'damageOpp', amount })),
    fc.tuple(intIn(1, 5), fc.boolean(), maybe(filterArb)).map(([count, upTo, filter]): Step => ({ do: 'salvage', count, ...flag('upTo', upTo && allowUpTo), ...opt('filter', filter) })),
    lookArb(allowUpTo),
    targetArb(kind).map((target): Step => ({ do: 'sendToWaiting', target })),
    targetArb(kind).map((target): Step => ({ do: 'returnToHand', target })),
  );

/** A step that acts on the cards a choose picked; the name is filled in by `renameChoices`. */
const refStepArb: fc.Arbitrary<Step> = fc.oneof(
  powerArb.map((amount): Step => ({ do: 'power', amount, target: { ref: '?' } })),
  soulArb.map((amount): Step => ({ do: 'soul', amount, target: { ref: '?' } })),
  fc.constant<Step>({ do: 'sendToWaiting', target: { ref: '?' } }),
  fc.constant<Step>({ do: 'returnToHand', target: { ref: '?' } }),
);
const chooseArb = (kind: GenKind, allowUpTo: boolean): fc.Arbitrary<Step> =>
  // Only 1 attacking or defending character can be chosen.
  fc.tuple(intIn(1, 5), fc.boolean(), selectorArb(kind)).map(([count, upTo, what]): Step => ({ do: 'choose', as: '?', count: what.role ? 1 : count, ...flag('upTo', upTo && allowUpTo), what }));

/** One to two steps. Nesting (may, if) only while the lists inside stay within depth 3. */
function itemArb(kind: GenKind, depth: number): fc.Arbitrary<Step[]> {
  const plain = plainStepArb(kind, true).map((s) => [s]);
  const chooseThenRef = fc.tuple(chooseArb(kind, true), refStepArb).map(([c, r]) => [c, r]);
  if (depth >= ABILITY_LIMITS.depth) return fc.oneof(plain, chooseThenRef);
  const inner = listArb(kind, depth + 1);
  const may = fc
    .tuple(plainStepArb(kind, false), maybe(inner), maybe(inner))
    .map(([step, then, otherwise]): Step[] => [{ do: 'may', steps: [step], ...opt('then', then), ...opt('else', otherwise) }]);
  const mayChoose = fc.tuple(chooseArb(kind, false), refStepArb).map(([c, r]): Step[] => [{ do: 'may', steps: [c], then: [r] }]);
  const cond = fc.tuple(conditionsArb, inner, maybe(inner)).map(([when, then, otherwise]): Step[] => [{ do: 'if', when, then, ...opt('else', otherwise) }]);
  return fc.oneof({ weight: 4, arbitrary: plain }, { weight: 2, arbitrary: chooseThenRef }, { weight: 1, arbitrary: may }, { weight: 1, arbitrary: mayChoose }, { weight: 1, arbitrary: cond });
}

function listArb(kind: GenKind, depth: number): fc.Arbitrary<Step[]> {
  return fc.array(itemArb(kind, depth), { minLength: 1, maxLength: 4 }).map((items) => items.flat());
}

/** Gives every choose a fresh name and points each ref at the choose just before it. */
function renameChoices(steps: readonly Step[], st: { n: number; last: string }): Step[] {
  return steps.map((s): Step => {
    if (s.do === 'choose') {
      st.n += 1;
      st.last = `c${st.n}`;
      return { ...s, as: st.last };
    }
    if ((s.do === 'power' || s.do === 'soul') && typeof s.target === 'object' && 'ref' in s.target) return { ...s, target: { ref: st.last } };
    if ((s.do === 'sendToWaiting' || s.do === 'returnToHand') && typeof s.target === 'object' && 'ref' in s.target) return { ...s, target: { ref: st.last } };
    if (s.do === 'may') {
      const inner = renameChoices(s.steps, st);
      return { ...s, steps: inner, ...opt('then', s.then && renameChoices(s.then, st)), ...opt('else', s.else && renameChoices(s.else, st)) };
    }
    if (s.do === 'if') return { ...s, then: renameChoices(s.then, st), ...opt('else', s.else && renameChoices(s.else, st)) };
    return s;
  });
}

const effectArb = (kind: GenKind) => listArb(kind, 1).map((steps) => renameChoices(steps, { n: 0, last: '?' }));

const costArb = (kind: GenKind): fc.Arbitrary<CostPart[]> =>
  fc.tuple(maybe(intIn(1, 5)), maybe(fc.tuple(intIn(1, 5), maybe(filterArb))), fc.boolean(), fc.boolean()).map(([stock, discard, rest, self]) => {
    const parts: CostPart[] = [];
    if (stock !== undefined) parts.push({ pay: 'stock', count: stock });
    if (discard) parts.push({ pay: 'discard', count: discard[0], ...opt('filter', discard[1]) });
    if (rest && kind === 'character') parts.push({ pay: 'rest' });
    if (self) parts.push({ pay: 'selfToWaiting' });
    return parts.length > 0 ? parts : [{ pay: 'stock', count: 1 }];
  });

const modifierArb = (kind: GenKind): fc.Arbitrary<Modifier> =>
  fc
    .tuple(fc.boolean(), powerArb, soulArb, kind === 'character' ? fc.oneof(fc.constant<'this'>('this'), selectorArb(kind)) : selectorArb(kind))
    .map(([isPower, power, soul, target]): Modifier => (isPower ? { stat: 'power', amount: power, target } : { stat: 'soul', amount: soul, target }));

const triggerArb = (kind: GenKind): fc.Arbitrary<Trigger> =>
  kind === 'character'
    ? fc.oneof(
        fc.constantFrom<Trigger>({ on: 'play' }, { on: 'attack' }, { on: 'reversed' }, { on: 'climaxPlayed' }),
        fc.constantFrom('Ember Gate', 'Yellow Dawn').map((name): Trigger => ({ on: 'climaxPlayed', name })),
      )
    : fc.constant<Trigger>({ on: 'play' });

const abilityArb = (kind: GenKind): fc.Arbitrary<Ability> => {
  const automatic = fc
    .tuple(triggerArb(kind), maybe(costArb(kind)), effectArb(kind))
    .map(([trigger, cost, effect]): Ability => ({ kind: 'automatic', trigger, ...opt('cost', cost), effect }));
  const continuous = fc
    .tuple(maybe(conditionsArb), fc.array(modifierArb(kind), { minLength: 1, maxLength: 4 }))
    .map(([when, modifiers]): Ability => ({ kind: 'continuous', ...opt('when', when), modifiers }));
  if (kind !== 'character') return fc.oneof(automatic, continuous);
  const activated = fc
    .tuple(fc.constantFrom<'main' | 'counter'>('main', 'counter'), costArb(kind), maybe(conditionsArb), effectArb(kind))
    .map(([timing, cost, when, effect]): Ability => ({ kind: 'activated', timing, cost, ...opt('when', when), effect }));
  return fc.oneof(activated, automatic, continuous);
};

const cardArb: fc.Arbitrary<CardDef> = fc.oneof(
  fc.array(abilityArb('character'), { minLength: 1, maxLength: 4 }).map((abilities) => unit('GEN', 'Generated Unit', abilities)),
  fc.array(abilityArb('climax'), { minLength: 1, maxLength: 4 }).map((abilities) => climaxCard('GEN', 'Generated Climax', abilities)),
  effectArb('event').map((effect) => eventCard('GEN', 'Generated Event', effect)),
);

describe('ability checker and renderer: generated valid cards', () => {
  it('every card built from the language within its limits is accepted, and renders as clean text, one line per ability', () => {
    fc.assert(
      fc.property(cardArb, (def) => {
        expect(checkCardAbilities(def, 'card GEN')).toEqual([]);
        expect(validateCatalog({ GEN: def })).toEqual([]);
        const lines = cardText(def);
        expect(cardText(def)).toEqual(lines);
        if (def.kind === 'event') expect(lines).toEqual([effectText(def.effect ?? [])]);
        else expect(lines).toEqual((def.abilities ?? []).map(abilityText));
        expect(lines).toHaveLength(def.kind === 'event' ? 1 : (def.abilities ?? []).length);
        for (const line of lines) {
          expect(line).not.toMatch(/undefined|NaN|null|\[object|\s\s|\s[.,]|\.\.|^\s|\s$/);
          expect(line).toMatch(/\.$/);
          if (def.kind !== 'event') expect(line).toMatch(/^\[(ACT|COUNTER|AUTO|CONT)\] /);
        }
      }),
      { seed: 20261016, numRuns: 400 },
    );
  });
});

// =============================================================================
// The renderer: exact text for example cards
// =============================================================================

const TEXT_CARDS: readonly (readonly [CardDef, readonly string[]])[] = [
  [{ id: 'TX-VAN', name: 'Plain Recruit', kind: 'character', color: 'yellow', level: 1, cost: 0, power: 4500, soul: 1 }, []],
  [{ id: 'TX-VAN2', name: 'Bare Recruit', kind: 'character', color: 'red', level: 0, cost: 0, power: 3000, soul: 1 }, []],
  [eventCard('TX-EVN', 'Blank Order'), []],
  [
    unit('TX-ACT', 'Signal Officer', [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'stock', count: 1 }, { pay: 'rest' }],
        when: [{ if: 'level', min: 2 }],
        effect: [
          { do: 'choose', as: 'pal', count: 1, what: { side: 'you', trait: 'Squad' } },
          { do: 'power', amount: 1500, target: { ref: 'pal' } },
        ],
      },
    ]),
    ['[ACT] [(1), Rest this card] Use only if your level is 2 or more. Choose 1 of your «Squad» characters. That character gets +1500 power until end of turn.'],
  ],
  [
    unit('TX-CTR', 'Shield Adept', [
      {
        kind: 'activated',
        timing: 'counter',
        cost: [{ pay: 'stock', count: 2 }, { pay: 'discard', count: 1, filter: { kind: 'climax' } }],
        effect: [{ do: 'power', amount: 2500, target: 'this' }, { do: 'soul', amount: 1, target: 'this' }],
      },
    ]),
    ['[COUNTER] [ACT] [(2), Put a climax from your hand into your waiting room] This card gets +2500 power until end of turn. This card gets +1 soul until end of turn.'],
  ],
  [
    unit('TX-PLAY', 'Archive Runner', [
      { kind: 'automatic', trigger: { on: 'play' }, cost: [{ pay: 'stock', count: 1 }], effect: [{ do: 'salvage', count: 1, filter: { kind: 'character', level: { max: 1 } } }] },
    ]),
    ['[AUTO] [(1)] When this card is played and placed, you may pay the cost. If you do, choose 1 level 1 or lower character in your waiting room and return it to your hand.'],
  ],
  [
    unit('TX-ATK', 'Breach Lancer', [
      {
        kind: 'automatic',
        trigger: { on: 'attack' },
        effect: [
          { do: 'soul', amount: 1, target: 'this' },
          { do: 'power', amount: -1000, target: { all: { side: 'opponent', role: 'defender' } } },
        ],
      },
    ]),
    ["[AUTO] When this card attacks, this card gets +1 soul until end of turn. Your opponent's defending character gets -1000 power until end of turn."],
  ],
  [
    unit('TX-REV', 'Fallback Scout', [
      {
        kind: 'automatic',
        trigger: { on: 'reversed' },
        effect: [{ do: 'may', steps: [{ do: 'returnToHand', target: 'this' }], then: [{ do: 'discard', count: 1 }], else: [{ do: 'stockFromDeck', count: 1 }] }],
      },
    ]),
    [
      '[AUTO] When this card becomes reversed, you may return this card to your hand; if you do, put 1 card from your hand into your waiting room; if you do not, put the top card of your deck into your stock.',
    ],
  ],
  [
    unit('TX-CXW', 'Gate Watcher', [
      {
        kind: 'automatic',
        trigger: { on: 'climaxPlayed', name: 'Ember Gate' },
        effect: [{ do: 'if', when: [{ if: 'turn', side: 'you' }], then: [{ do: 'draw', count: 1 }], else: [{ do: 'heal', count: 1 }] }],
      },
    ]),
    ['[AUTO] When "Ember Gate" is placed in your climax area, if it is your turn, draw 1 card; otherwise, put the top card of your clock into your waiting room.'],
  ],
  [
    unit('TX-CONT', 'Pack Leader', [
      {
        kind: 'continuous',
        when: [
          { if: 'count', what: { side: 'you', trait: 'Squad' }, min: 2 },
          { if: 'climax', side: 'opponent' },
        ],
        // One modifier only: with several, the current text puts the later ones in
        // sentences of their own (see "card text says what the card does" below).
        modifiers: [{ stat: 'soul', amount: 1, target: 'this' }],
      },
    ]),
    ['[CONT] While there are 2 or more of your «Squad» characters on the stage and your opponent has a climax in the climax area, this card gets +1 soul.'],
  ],
  [
    unit('TX-CXANY', 'Spark Listener', [{ kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [{ do: 'heal', count: 1 }] }]),
    ['[AUTO] When a climax is placed in your climax area, put the top card of your clock into your waiting room.'],
  ],
  [
    unit('TX-AURA', 'Banner Bearer', [
      { kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: { side: 'you', color: 'yellow' } }] },
      { kind: 'continuous', when: [{ if: 'turn', side: 'opponent' }], modifiers: [{ stat: 'soul', amount: 1, target: { side: 'you', level: { min: 2 } } }] },
    ]),
    ['[CONT] All of your yellow characters get +500 power.', "[CONT] While it is your opponent's turn, all of your level 2 or higher characters get +1 soul."],
  ],
  [
    eventCard('TX-LOOK', 'Deep Survey', [{ do: 'lookTop', count: 4, take: { count: 1, upTo: true, filter: { kind: 'character', trait: 'Squad' }, to: 'hand' }, rest: 'bottom' }]),
    ['Look at 4 cards from the top of your deck, choose up to 1 «Squad» character among them and put it into your hand, and put the rest on the bottom of your deck in any order.'],
  ],
  [
    eventCard('TX-OPP', 'Pressure Drill', [
      { do: 'draw', count: 2, upTo: true },
      { do: 'discard', count: 1, player: 'opponent' },
      { do: 'damageOpp', amount: 2 },
    ]),
    ['Draw up to 2 cards. Your opponent puts 1 card from their hand into their waiting room. Deal 2 damage to your opponent.'],
  ],
  [
    eventCard('TX-BOUNCE', 'Recall Order', [
      { do: 'choose', as: 'foe', count: 1, what: { side: 'opponent', level: { max: 0 } } },
      { do: 'returnToHand', target: { ref: 'foe' } },
    ]),
    ["Choose 1 of your opponent's level 0 characters. Return that character to its owner's hand."],
  ],
  [
    climaxCard('TX-CXA', 'Rising Chorus', [
      {
        kind: 'continuous',
        modifiers: [
          { stat: 'power', amount: 1000, target: { side: 'you' } },
          { stat: 'soul', amount: 1, target: { side: 'you' } },
        ],
      },
      { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'stockFromDeck', count: 2 }, { do: 'draw', count: 1 }] },
    ]),
    ['[CONT] All of your characters get +1000 power and +1 soul.', '[AUTO] When this card is played and placed, put the top 2 cards of your deck into your stock. Draw 1 card.'],
  ],
  [
    unit('TX-SAC', 'Last Stand Medic', [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'discard', count: 2, filter: { color: 'blue' } }, { pay: 'selfToWaiting' }],
        effect: [{ do: 'power', amount: 3000, target: { all: { side: 'you', name: 'Yellow Scout' } }, duration: 'game' }],
      },
    ]),
    ['[ACT] [Put 2 blue cards from your hand into your waiting room, Put this card into your waiting room] All of your characters named "Yellow Scout" get +3000 power.'],
  ],
  [
    unit('TX-HEAL', 'Field Surgeon', [
      {
        kind: 'automatic',
        trigger: { on: 'play' },
        effect: [{ do: 'if', when: [{ if: 'count', what: { side: 'you', zone: 'waiting', kind: 'event' }, min: 2, max: 4 }], then: [{ do: 'heal', count: 2 }] }],
      },
    ]),
    ['[AUTO] When this card is played and placed, if there are 2 to 4 of your events in the waiting room, put the top 2 cards of your clock into your waiting room.'],
  ],
  [
    eventCard('TX-SCOPE', 'Split Volley', [
      {
        do: 'if',
        when: [{ if: 'level', side: 'opponent', min: 2 }],
        then: [
          { do: 'choose', as: 't', count: 1, what: { side: 'opponent' } },
          { do: 'power', amount: -1000, target: { ref: 't' } },
        ],
        else: [
          { do: 'choose', as: 'u', count: 2, what: { side: 'opponent' } },
          { do: 'power', amount: -500, target: { ref: 'u' } },
        ],
      },
    ]),
    [
      "If your opponent's level is 2 or more, choose 1 of your opponent's characters, then that character gets -1000 power until end of turn; otherwise, choose 2 of your opponent's characters, then those characters get -500 power until end of turn.",
    ],
  ],
  [
    unit('TX-MAYC', 'Wing Partner', [
      {
        kind: 'automatic',
        trigger: { on: 'attack' },
        effect: [{ do: 'may', steps: [{ do: 'choose', as: 'ally', count: 1, what: { side: 'you', other: true } }], then: [{ do: 'soul', amount: 1, target: { ref: 'ally' } }] }],
      },
    ]),
    ['[AUTO] When this card attacks, you may choose 1 of your other characters; if you do, that character gets +1 soul until end of turn.'],
  ],
  [
    unit('TX-SELF', 'Overload Gunner', [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'stock', count: 3 }],
        when: [
          { if: 'climax', name: 'Ember Gate' },
          { if: 'turn', side: 'you' },
        ],
        effect: [{ do: 'damageOpp', amount: 1 }, { do: 'sendToWaiting', target: 'this' }],
      },
    ]),
    ['[ACT] [(3)] Use only if you have "Ember Gate" in the climax area and it is your turn. Deal 1 damage to your opponent. Put this card into your waiting room.'],
  ],
  [
    unit('TX-WALL', 'Echo Breaker', [{ kind: 'automatic', trigger: { on: 'reversed' }, effect: [{ do: 'sendToWaiting', target: { all: { side: 'opponent', role: 'attacker' } } }] }]),
    ["[AUTO] When this card becomes reversed, put your opponent's attacking character into its owner's waiting room."],
  ],
];

describe('card text: exact text for example cards', () => {
  it('the example cards are valid card data', () => {
    expect(TEXT_CARDS.length).toBeGreaterThanOrEqual(12);
    expect(validateCatalog({ ...catalog, ...byId(TEXT_CARDS.map(([d]) => d)) })).toEqual([]);
  });

  it.each(TEXT_CARDS.map(([d, text]) => [d.id, d, text] as const))('%s', (_id, def, text) => {
    expect(cardText(def)).toEqual(text);
    // One line per ability, each the same as that ability's own text.
    if (def.kind !== 'event') expect(cardText(def)).toEqual((def.abilities ?? []).map(abilityText));
  });
});

describe('card text: the pieces', () => {
  const pickLevel = (level: NonNullable<CardFilter['level']>) => effectText([{ do: 'choose', as: 'a', count: 1, what: { side: 'you', level } }]);

  it('level ranges', () => {
    expect(pickLevel({ min: 0 })).toBe('Choose 1 of your level 0 or higher characters.');
    expect(pickLevel({ max: 0 })).toBe('Choose 1 of your level 0 characters.');
    expect(pickLevel({ min: 1, max: 1 })).toBe('Choose 1 of your level 1 characters.');
    expect(pickLevel({ min: 1, max: 2 })).toBe('Choose 1 of your level 1 to 2 characters.');
    expect(pickLevel({ max: 2 })).toBe('Choose 1 of your level 2 or lower characters.');
    expect(pickLevel({ min: 3 })).toBe('Choose 1 of your level 3 or higher characters.');
  });

  it('qualifiers come in the order level, color, trait, then the name', () => {
    expect(effectText([{ do: 'choose', as: 'a', count: 2, upTo: true, what: { side: 'opponent', name: 'Night Lancer', trait: 'Squad', color: 'red', level: { min: 2 } } }])).toBe(
      'Choose up to 2 of your opponent\'s level 2 or higher red «Squad» characters named "Night Lancer".',
    );
  });

  it('conditions', () => {
    expect(conditionText({ if: 'level', min: 2, max: 2 })).toBe('your level is exactly 2');
    expect(conditionText({ if: 'level', side: 'opponent', max: 1 })).toBe("your opponent's level is 1 or fewer");
    expect(conditionText({ if: 'level', min: 1, max: 3 })).toBe('your level is 1 to 3');
    expect(conditionText({ if: 'level', side: 'you', min: 0 })).toBe('your level is 0 or more');
    expect(conditionText({ if: 'climax' })).toBe('you have a climax in the climax area');
    expect(conditionText({ if: 'climax', side: 'opponent', name: 'Ember Gate' })).toBe('your opponent has "Ember Gate" in the climax area');
    expect(conditionText({ if: 'turn', side: 'you' })).toBe('it is your turn');
    expect(conditionText({ if: 'turn', side: 'opponent' })).toBe("it is your opponent's turn");
  });

  it('count conditions: characters on the stage by default, other zones by name', () => {
    expect(conditionText({ if: 'count', what: { side: 'you' }, min: 1 })).toBe('there are 1 or more of your characters on the stage');
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'stage', trait: 'Squad' }, max: 2 })).toBe('there are 2 or fewer of your «Squad» characters on the stage');
    expect(conditionText({ if: 'count', what: { side: 'opponent', zone: 'hand' }, max: 3 })).toBe("there are 3 or fewer of your opponent's cards in the hand");
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'clock', color: 'red' }, min: 2 })).toBe('there are 2 or more of your red cards in the clock');
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'stock' }, min: 3, max: 3 })).toBe('there are exactly 3 of your cards in the stock');
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'climax' }, min: 1 })).toBe('there are 1 or more of your cards in the climax area');
    expect(conditionText({ if: 'count', what: { side: 'opponent', zone: 'waiting', kind: 'character' }, min: 4 })).toBe(
      "there are 4 or more of your opponent's characters in the waiting room",
    );
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'climax', name: 'Yellow Dawn' }, min: 1 })).toBe('there are 1 or more of your cards named "Yellow Dawn" in the climax area');
    // The rules call the level zone just "the level" (CR 3.9).
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'level', level: { min: 1 } }, min: 2 })).toBe('there are 2 or more of your level 1 or higher cards in the level zone');
    // A card kind named for the stage is kept, not replaced by "characters".
    expect(conditionText({ if: 'count', what: { side: 'you', zone: 'stage', kind: 'event' }, max: 0 })).toBe('there are 0 or fewer of your events on the stage');
  });

  it('count conditions: climaxes with no zone named are counted in the climax area, not on the stage', () => {
    // Checked by its ending only, so it holds whatever the plural of "climax" is.
    const text = conditionText({ if: 'count', what: { side: 'opponent', kind: 'climax' }, max: 0 });
    expect(text).toMatch(/^there are 0 or fewer of your opponent's climax\w* in the climax area$/);
  });

  it('costs, in the order written', () => {
    expect(costText([{ pay: 'stock', count: 1 }, { pay: 'rest' }, { pay: 'selfToWaiting' }])).toBe('(1), Rest this card, Put this card into your waiting room');
    expect(costText([{ pay: 'selfToWaiting' }, { pay: 'stock', count: 2 }])).toBe('Put this card into your waiting room, (2)');
    expect(costText([{ pay: 'discard', count: 1 }])).toBe('Put a card from your hand into your waiting room');
    expect(costText([{ pay: 'discard', count: 3, filter: { trait: 'Squad', level: { max: 1 } } }])).toBe('Put 3 level 1 or lower «Squad» cards from your hand into your waiting room');
  });

  it.each([
    [[{ do: 'draw', count: 1 }], 'Draw 1 card.'],
    [[{ do: 'draw', count: 3, upTo: true }], 'Draw up to 3 cards.'],
    [[{ do: 'draw', count: 2, player: 'opponent' }], 'Your opponent draws 2 cards.'],
    [[{ do: 'discard', count: 2, upTo: true, filter: { kind: 'character' } }], 'Put up to 2 characters from your hand into your waiting room.'],
    [[{ do: 'stockFromDeck', count: 1 }], 'Put the top card of your deck into your stock.'],
    [[{ do: 'stockFromDeck', count: 3 }], 'Put the top 3 cards of your deck into your stock.'],
    [[{ do: 'heal', count: 1 }], 'Put the top card of your clock into your waiting room.'],
    [[{ do: 'heal', count: 2 }], 'Put the top 2 cards of your clock into your waiting room.'],
    [[{ do: 'damageOpp', amount: 3 }], 'Deal 3 damage to your opponent.'],
    [[{ do: 'salvage', count: 2, upTo: true }], 'Choose up to 2 cards in your waiting room and return them to your hand.'],
    [[{ do: 'salvage', count: 1, filter: { name: 'Night Lancer' } }], 'Choose 1 card named "Night Lancer" in your waiting room and return it to your hand.'],
    [
      [{ do: 'lookTop', count: 2, take: { count: 1, to: 'waiting' }, rest: 'bottom' }],
      'Look at 2 cards from the top of your deck, choose 1 card among them and put it into your waiting room, and put the rest on the bottom of your deck in any order.',
    ],
    [
      [{ do: 'power', amount: 1000, target: { all: { side: 'you', role: 'attacker', name: 'Night Lancer' } } }],
      'Your attacking character named "Night Lancer" gets +1000 power until end of turn.',
    ],
    [[{ do: 'lookTop', count: 1, rest: 'top' }], 'Look at 1 card from the top of your deck, and put the rest on top of your deck in any order.'],
    [
      [{ do: 'lookTop', count: 5, upTo: true, take: { count: 2, to: 'stock' }, rest: 'waiting' }],
      'Look at up to 5 cards from the top of your deck, choose 2 cards among them and put them into your stock, and put the rest into your waiting room.',
    ],
    [[{ do: 'power', amount: 1000, target: { all: { side: 'you' } }, duration: 'turn' }], 'All of your characters get +1000 power until end of turn.'],
    [[{ do: 'power', amount: 1000, target: { all: { side: 'you' } }, duration: 'game' }], 'All of your characters get +1000 power.'],
    [[{ do: 'soul', amount: -2, target: { all: { side: 'opponent' } } }], "All of your opponent's characters get -2 soul until end of turn."],
    [
      [
        { do: 'choose', as: 'p', count: 2, what: { side: 'you' } },
        { do: 'power', amount: 500, target: { ref: 'p' } },
      ],
      'Choose 2 of your characters. Those characters get +500 power until end of turn.',
    ],
    [
      [
        { do: 'choose', as: 'p', count: 3, upTo: true, what: { side: 'you' } },
        { do: 'soul', amount: 1, target: { ref: 'p' } },
      ],
      'Choose up to 3 of your characters. Those characters get +1 soul until end of turn.',
    ],
    [[{ do: 'if', when: [{ if: 'turn', side: 'you' }, { if: 'level', min: 1 }], then: [{ do: 'draw', count: 1 }] }], 'If it is your turn and your level is 1 or more, draw 1 card.'],
    [[{ do: 'may', steps: [{ do: 'draw', count: 1 }], then: [{ do: 'discard', count: 1 }] }], 'You may draw 1 card; if you do, put 1 card from your hand into your waiting room.'],
    [[{ do: 'may', steps: [{ do: 'discard', count: 1 }], else: [{ do: 'damageOpp', amount: 1 }] }], 'You may put 1 card from your hand into your waiting room; if you do not, deal 1 damage to your opponent.'],
  ] satisfies [Step[], string][])('effect text %#', (steps, text) => {
    expect(effectText(steps)).toBe(text);
  });
});

// =============================================================================
// The renderer is deterministic
// =============================================================================

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** The same data with every object's keys in reverse order. */
function reverseKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(reverseKeys);
  if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return x;
}

describe('card text: deterministic output', () => {
  const defs = TEXT_CARDS.map(([d]) => d);

  it('rendering the same card again gives the same lines, in any call order', () => {
    const first = defs.map(cardText);
    const backwards = [...defs].reverse().map(cardText).reverse();
    const interleaved = defs.map((d, i) => {
      cardText(defs[(i + 7) % defs.length] ?? d);
      return cardText(d);
    });
    expect(backwards).toEqual(first);
    expect(interleaved).toEqual(first);
  });

  it('does not change the card data (frozen definitions render the same)', () => {
    const before = JSON.stringify(defs);
    const plain = defs.map(cardText);
    const frozen = (JSON.parse(before) as CardDef[]).map(deepFreeze);
    expect(frozen.map(cardText)).toEqual(plain);
    expect(JSON.stringify(defs)).toBe(before);
  });

  it('does not depend on the order of keys in the data (an imported file may list them in any order)', () => {
    for (const def of [...defs, ...VALID]) expect(cardText(reverseKeys(def) as CardDef)).toEqual(cardText(def));
  });

  it('choice names do not leak between calls: an unknown ref reads as one character every time', () => {
    const lonely: Step[] = [{ do: 'power', amount: 1000, target: { ref: 'p' } }];
    expect(effectText(lonely)).toBe('That character gets +1000 power until end of turn.');
    effectText([{ do: 'choose', as: 'p', count: 3, what: { side: 'you' } }]);
    expect(cardText(eventCard('TX-TMP', 'Temp', [{ do: 'choose', as: 'p', count: 2, what: { side: 'you' } }, ...lonely]))).toEqual([
      'Choose 2 of your characters. Those characters get +1000 power until end of turn.',
    ]);
    expect(effectText(lonely)).toBe('That character gets +1000 power until end of turn.');
  });

  it('a name chosen in each branch of an if is read with that branch\'s own count', () => {
    // Rendered here (not read from the table above), in both branch orders.
    const branch = (count: number, amount: number): Step[] => [
      { do: 'choose', as: 't', count, what: { side: 'opponent' } },
      { do: 'power', amount, target: { ref: 't' } },
    ];
    const oneThenTwo = effectText([{ do: 'if', when: [{ if: 'turn', side: 'you' }], then: branch(1, -1000), else: branch(2, -500) }]);
    const twoThenOne = effectText([{ do: 'if', when: [{ if: 'turn', side: 'you' }], then: branch(2, -500), else: branch(1, -1000) }]);
    for (const text of [oneThenTwo, twoThenOne]) {
      expect(text).toMatch(/that character gets -1000/i);
      expect(text).toMatch(/those characters get -500/i);
      expect(text).not.toMatch(/those characters get -1000|that character gets -500/i);
    }
  });
});

// =============================================================================
// Renderer defects found while writing these tests (expected to fail until fixed)
// =============================================================================

describe('card text reads as correct English', () => {
  it('the plural of "climax" is "climaxes"', () => {
    expect(costText([{ pay: 'discard', count: 2, filter: { kind: 'climax' } }])).toBe('Put 2 climaxes from your hand into your waiting room');
    expect(conditionText({ if: 'count', what: { side: 'you', kind: 'climax' }, min: 1 })).toBe('there are 1 or more of your climaxes in the climax area');
  });

  it('a single event card takes the article "an"', () => {
    expect(costText([{ pay: 'discard', count: 1, filter: { kind: 'event' } }])).toBe('Put an event from your hand into your waiting room');
  });

  it('a continuous modifier on the attacking or defending character uses a singular verb', () => {
    expect(abilityText({ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', role: 'attacker' } }] })).toBe(
      '[CONT] Your attacking character gets +1000 power.',
    );
  });

  it('several characters are not sent to "its owner\'s" zone', () => {
    expect(effectText([{ do: 'sendToWaiting', target: { all: { side: 'opponent', level: { max: 0 } } } }])).not.toContain("its owner's");
    expect(
      effectText([
        { do: 'choose', as: 'x', count: 2, what: { side: 'opponent' } },
        { do: 'returnToHand', target: { ref: 'x' } },
      ]),
    ).not.toContain("its owner's");
  });

  it('"you may" is followed by something the player does', () => {
    expect(effectText([{ do: 'may', steps: [{ do: 'power', amount: 1000, target: 'this' }] }])).not.toMatch(/^You may this card gets/);
    expect(effectText([{ do: 'may', steps: [{ do: 'draw', count: 1, player: 'opponent' }] }])).not.toMatch(/^You may your opponent draws/);
  });

  it('qualifiers follow "your" and "other" instead of coming before them', () => {
    expect(effectText([{ do: 'choose', as: 'a', count: 1, what: { side: 'you', other: true, trait: 'Squad' } }])).toBe('Choose 1 of your other «Squad» characters.');
    expect(effectText([{ do: 'power', amount: 1000, target: { all: { side: 'you', role: 'attacker', level: { max: 1 } } } }])).not.toMatch(/^Level 1 or lower your/);
  });
});

describe('card text says what the card does', () => {
  /** The sentences after the first "If you do, " (or the whole text if there is none). */
  const afterIfYouDo = (text: string) => text.split('If you do, ').slice(1).join('If you do, ') || text;
  /** True when the text holds a second sentence (a full stop followed by a capital letter). */
  const twoSentences = (text: string) => /\. [A-Z]/.test(text);
  const drawThenDiscard: Step[] = [
    { do: 'draw', count: 1 },
    { do: 'discard', count: 1 },
  ];

  it('every step a condition or "if you do" governs reads as part of it, not as a separate sentence', () => {
    // The engine runs the whole `then` list only when the condition holds (or the
    // optional action was done), and every modifier only while `when` holds.
    expect(twoSentences(effectText([{ do: 'if', when: [{ if: 'turn', side: 'you' }], then: drawThenDiscard }]))).toBe(false);
    expect(
      twoSentences(
        abilityText({
          kind: 'continuous',
          when: [{ if: 'turn', side: 'you' }],
          modifiers: [
            { stat: 'power', amount: 1000, target: 'this' },
            { stat: 'soul', amount: 1, target: 'this' },
          ],
        }),
      ),
    ).toBe(false);
    expect(twoSentences(afterIfYouDo(effectText([{ do: 'may', steps: [{ do: 'heal', count: 1 }], then: drawThenDiscard }])))).toBe(false);
    expect(twoSentences(afterIfYouDo(abilityText({ kind: 'automatic', trigger: { on: 'play' }, cost: [{ pay: 'stock', count: 1 }], effect: drawThenDiscard })))).toBe(false);
  });

  it('an "up to" choice of the attacking or defending character still reads as optional', () => {
    const text = effectText([{ do: 'choose', as: 'd', count: 1, upTo: true, what: { side: 'opponent', role: 'defender' } }]);
    expect(text).toMatch(/up to|\bmay\b/i);
  });
});
