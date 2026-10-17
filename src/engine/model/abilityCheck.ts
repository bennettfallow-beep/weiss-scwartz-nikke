// Static checks for card abilities. Card data may come from an imported file,
// so this works on unknown input, never throws, rejects unknown keys, and caps
// sizes and nesting before looking deeper. Each problem has a stable code and a
// path into the card (e.g. "abilities.0.effect.1.count") the importer can show.

import {
  ABILITY_KINDS,
  ABILITY_TIMINGS,
  CONDITION_KINDS,
  COST_KINDS,
  COUNT_ZONES,
  DURATIONS,
  LOOK_DESTINATIONS,
  LOOK_REST,
  SIDES,
  STEP_KINDS,
  TRIGGER_KINDS,
} from './abilities';
import { CARD_KINDS, COLORS } from './types';
import type { EngineError } from './types';

export const ABILITY_ERROR_CODES = [
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
] as const;
export type AbilityErrorCode = (typeof ABILITY_ERROR_CODES)[number];

/** Size limits that keep card text readable and the engine's work bounded. */
export const ABILITY_LIMITS = {
  abilities: 4,
  steps: 8,
  depth: 3,
  count: 5,
  lookCount: 10,
  power: 20000,
  soul: 3,
  damage: 5,
  text: 40,
} as const;

const NAME_PATTERN = /^[a-z][a-z0-9]{0,11}$/;

type Obj = Record<string, unknown>;
interface Ctx {
  cardKind: unknown;
  at: string;
  errors: EngineError[];
  /** Every choose name in the ability being checked: names must be unique across the whole ability. */
  names: Set<string>;
}

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const inList = (list: readonly string[], x: unknown): boolean => typeof x === 'string' && list.includes(x);

function err(c: Ctx, code: AbilityErrorCode, path: string, message: string): void {
  c.errors.push({ code, message: `${c.at}: ${path}: ${message}`, path });
}

/** True if `x` is an object with only the given keys and all required ones present; reports otherwise. */
function shape(c: Ctx, x: unknown, path: string, required: readonly string[], optional: readonly string[] = []): x is Obj {
  if (!isObj(x)) {
    err(c, 'ABILITY_SHAPE', path, 'must be an object');
    return false;
  }
  let ok = true;
  for (const key of Object.keys(x)) {
    if (!required.includes(key) && !optional.includes(key)) {
      err(c, 'ABILITY_SHAPE', `${path}.${key}`, 'unknown field');
      ok = false;
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(x, key)) {
      err(c, 'ABILITY_SHAPE', `${path}.${key}`, 'missing');
      ok = false;
    }
  }
  return ok;
}

/** A list of at most `max` entries; returns the entries to check, or null. */
function list(c: Ctx, x: unknown, path: string, max: number, min = 1): unknown[] | null {
  if (!Array.isArray(x)) {
    err(c, 'ABILITY_SHAPE', path, 'must be a list');
    return null;
  }
  if (x.length < min) err(c, 'ABILITY_SHAPE', path, `needs at least ${min} entr${min === 1 ? 'y' : 'ies'}`);
  if (x.length > max) {
    err(c, 'ABILITY_LIMIT', path, `at most ${max} entries`);
    return null;
  }
  const items: unknown[] = x;
  for (let i = 0; i < items.length; i++) {
    if (!Object.hasOwn(items, i)) {
      err(c, 'ABILITY_SHAPE', path, 'has an empty slot');
      return null;
    }
  }
  return items;
}

function count(c: Ctx, x: unknown, path: string, max: number = ABILITY_LIMITS.count): void {
  if (!isInt(x) || x < 1 || x > max) err(c, 'ABILITY_RANGE', path, `must be a whole number from 1 to ${max}`);
}

function text(c: Ctx, x: unknown, path: string): void {
  if (typeof x !== 'string' || x.trim() === '' || x.length > ABILITY_LIMITS.text) err(c, 'ABILITY_FILTER', path, `must be a name of 1-${ABILITY_LIMITS.text} characters`);
}

function upTo(c: Ctx, x: Obj, path: string): void {
  if (Object.hasOwn(x, 'upTo') && x.upTo !== true) err(c, 'ABILITY_SHAPE', `${path}.upTo`, 'must be true when present');
}

function levelRange(c: Ctx, x: unknown, path: string): void {
  if (!shape(c, x, path, [], ['min', 'max'])) return;
  const { min, max } = x;
  if (min === undefined && max === undefined) err(c, 'ABILITY_FILTER', path, 'needs min or max');
  for (const [k, v] of [
    ['min', min],
    ['max', max],
  ] as const) {
    if (v !== undefined && (!isInt(v) || v < 0 || v > 3)) err(c, 'ABILITY_FILTER', `${path}.${k}`, 'must be a level from 0 to 3');
  }
  if (isInt(min) && isInt(max) && min > max) err(c, 'ABILITY_FILTER', path, 'min is above max');
}

const FILTER_KEYS = ['kind', 'name', 'trait', 'color', 'level'] as const;

/** The card-information fields shared by filters, selectors and count specs. */
function filterFields(c: Ctx, x: Obj, path: string): void {
  if (Object.hasOwn(x, 'kind') && !inList(CARD_KINDS, x.kind)) err(c, 'ABILITY_FILTER', `${path}.kind`, 'must be character, event or climax');
  if (Object.hasOwn(x, 'name')) text(c, x.name, `${path}.name`);
  if (Object.hasOwn(x, 'trait')) text(c, x.trait, `${path}.trait`);
  if (Object.hasOwn(x, 'color') && !inList(COLORS, x.color)) err(c, 'ABILITY_FILTER', `${path}.color`, `must be one of ${COLORS.join(', ')}`);
  if (Object.hasOwn(x, 'level')) levelRange(c, x.level, `${path}.level`);
}

function filter(c: Ctx, x: unknown, path: string): void {
  if (shape(c, x, path, [], FILTER_KEYS)) filterFields(c, x, path);
}

function side(c: Ctx, x: unknown, path: string): void {
  if (!inList(SIDES, x)) err(c, 'ABILITY_FILTER', path, 'must be you or opponent');
}

function selector(c: Ctx, x: unknown, path: string): void {
  if (!shape(c, x, path, ['side'], ['other', 'role', 'name', 'trait', 'color', 'level'])) return;
  side(c, x.side, `${path}.side`);
  filterFields(c, x, path);
  if (Object.hasOwn(x, 'other')) {
    if (x.other !== true) err(c, 'ABILITY_SHAPE', `${path}.other`, 'must be true when present');
    // "Other" means other than the card with the ability, which must be a character on the stage.
    if (c.cardKind !== 'character') err(c, 'ABILITY_FILTER', `${path}.other`, 'only a character can refer to its other characters');
  }
  if (Object.hasOwn(x, 'role') && x.role !== 'attacker' && x.role !== 'defender') err(c, 'ABILITY_FILTER', `${path}.role`, 'must be attacker or defender');
}

function condition(c: Ctx, x: unknown, path: string): void {
  if (!isObj(x) || !inList(CONDITION_KINDS, x.if)) {
    err(c, 'ABILITY_CONDITION', `${path}.if`, `must be one of ${CONDITION_KINDS.join(', ')}`);
    return;
  }
  const bounds = (o: Obj) => {
    if (o.min === undefined && o.max === undefined) err(c, 'ABILITY_CONDITION', path, 'needs min or max');
    for (const k of ['min', 'max'] as const) {
      if (o[k] !== undefined && (!isInt(o[k]) || o[k] < 0 || o[k] > 99)) err(c, 'ABILITY_RANGE', `${path}.${k}`, 'must be a whole number from 0 to 99');
    }
    if (isInt(o.min) && isInt(o.max) && o.min > o.max) err(c, 'ABILITY_CONDITION', path, 'min is above max');
  };
  switch (x.if) {
    case 'level':
      if (!shape(c, x, path, ['if'], ['side', 'min', 'max'])) return;
      if (Object.hasOwn(x, 'side')) side(c, x.side, `${path}.side`);
      bounds(x);
      return;
    case 'climax':
      if (!shape(c, x, path, ['if'], ['side', 'name'])) return;
      if (Object.hasOwn(x, 'side')) side(c, x.side, `${path}.side`);
      if (Object.hasOwn(x, 'name')) text(c, x.name, `${path}.name`);
      return;
    case 'count': {
      if (!shape(c, x, path, ['if', 'what'], ['min', 'max'])) return;
      const what = x.what;
      if (shape(c, what, `${path}.what`, ['side'], ['zone', ...FILTER_KEYS])) {
        side(c, what.side, `${path}.what.side`);
        filterFields(c, what, `${path}.what`);
        if (Object.hasOwn(what, 'zone') && !inList(COUNT_ZONES, what.zone)) err(c, 'ABILITY_FILTER', `${path}.what.zone`, `must be one of ${COUNT_ZONES.join(', ')}`);
        // Counting hidden cards by their information would reveal them.
        const hidden = what.zone === 'hand' || what.zone === 'stock';
        if (hidden && FILTER_KEYS.some((k) => Object.hasOwn(what, k))) err(c, 'ABILITY_FILTER', `${path}.what`, 'cards in a hand or stock can only be counted, not filtered');
      }
      bounds(x);
      return;
    }
    case 'turn':
      if (!shape(c, x, path, ['if', 'side'])) return;
      side(c, x.side, `${path}.side`);
      return;
  }
}

function conditions(c: Ctx, x: unknown, path: string): void {
  const items = list(c, x, path, ABILITY_LIMITS.steps);
  items?.forEach((item, i) => condition(c, item, `${path}.${i}`));
}

function cost(c: Ctx, x: unknown, path: string): void {
  const parts = list(c, x, path, ABILITY_LIMITS.steps);
  if (!parts) return;
  let discards = 0;
  let rests = 0;
  let selves = 0;
  parts.forEach((part, i) => {
    const p = `${path}.${i}`;
    if (!isObj(part) || !inList(COST_KINDS, part.pay)) {
      err(c, 'ABILITY_COST', `${p}.pay`, `must be one of ${COST_KINDS.join(', ')}`);
      return;
    }
    switch (part.pay) {
      case 'stock':
        if (shape(c, part, p, ['pay', 'count'])) count(c, part.count, `${p}.count`);
        return;
      case 'discard':
        discards++;
        if (!shape(c, part, p, ['pay', 'count'], ['filter'])) return;
        count(c, part.count, `${p}.count`);
        if (Object.hasOwn(part, 'filter')) filter(c, part.filter, `${p}.filter`);
        return;
      case 'rest':
        rests++;
        if (!shape(c, part, p, ['pay'])) return;
        if (c.cardKind !== 'character') err(c, 'ABILITY_COST', p, 'only a character can rest itself');
        return;
      case 'selfToWaiting':
        selves++;
        if (!shape(c, part, p, ['pay'])) return;
        // Once this card has gone to the waiting room, no later part can use it.
        if (i !== parts.length - 1) err(c, 'ABILITY_COST', p, 'putting this card into the waiting room must be the last part of the cost');
        return;
    }
  });
  if (discards > 1) err(c, 'ABILITY_COST', path, 'at most one discard part');
  if (rests > 1) err(c, 'ABILITY_COST', path, 'at most one rest part');
  if (selves > 1) err(c, 'ABILITY_COST', path, 'at most one part putting this card into the waiting room');
}

function target(c: Ctx, x: unknown, path: string, scope: ReadonlySet<string>): void {
  if (x === 'this') {
    if (c.cardKind !== 'character') err(c, 'ABILITY_TARGET', path, '"this" is only for a character\'s own abilities');
    return;
  }
  if (isObj(x) && Object.hasOwn(x, 'ref')) {
    if (!shape(c, x, path, ['ref'])) return;
    if (typeof x.ref !== 'string' || !scope.has(x.ref)) err(c, 'ABILITY_REF', `${path}.ref`, 'must name a choose step earlier in the same list or an enclosing one');
    return;
  }
  if (isObj(x) && Object.hasOwn(x, 'all')) {
    if (shape(c, x, path, ['all'])) selector(c, x.all, `${path}.all`);
    return;
  }
  err(c, 'ABILITY_TARGET', path, 'must be "this", { ref } or { all }');
}

function amount(c: Ctx, x: unknown, path: string, max: number): void {
  if (!isInt(x) || x === 0 || Math.abs(x) > max) err(c, 'ABILITY_RANGE', path, `must be a non-zero whole number from -${max} to ${max}`);
}

/**
 * Checks a list of steps. `scope` holds the names chosen earlier and visible
 * here; names chosen in this list are added for the steps after them. Names
 * chosen inside a branch stay inside it.
 */
function steps(c: Ctx, x: unknown, path: string, scope: Set<string>, depth: number): void {
  if (depth > ABILITY_LIMITS.depth) {
    err(c, 'ABILITY_LIMIT', path, `nested more than ${ABILITY_LIMITS.depth} deep`);
    return;
  }
  const items = list(c, x, path, ABILITY_LIMITS.steps);
  items?.forEach((item, i) => step(c, item, `${path}.${i}`, scope, depth));
}

function step(c: Ctx, x: unknown, path: string, scope: Set<string>, depth: number): void {
  if (!isObj(x) || !inList(STEP_KINDS, x.do)) {
    err(c, 'ABILITY_STEP', `${path}.do`, `must be one of ${STEP_KINDS.join(', ')}`);
    return;
  }
  switch (x.do) {
    case 'choose':
      if (!shape(c, x, path, ['do', 'as', 'count', 'what'], ['upTo'])) return;
      if (typeof x.as !== 'string' || !NAME_PATTERN.test(x.as)) err(c, 'ABILITY_REF', `${path}.as`, 'must be a short lowercase name (a-z, 0-9, up to 12)');
      else if (c.names.has(x.as)) err(c, 'ABILITY_REF', `${path}.as`, `the name "${x.as}" is already used in this ability`);
      else {
        c.names.add(x.as);
        scope.add(x.as);
      }
      count(c, x.count, `${path}.count`);
      upTo(c, x, path);
      selector(c, x.what, `${path}.what`);
      return;
    case 'draw':
    case 'discard':
      if (!shape(c, x, path, ['do', 'count'], x.do === 'draw' ? ['upTo', 'player'] : ['upTo', 'player', 'filter'])) return;
      count(c, x.count, `${path}.count`);
      upTo(c, x, path);
      if (Object.hasOwn(x, 'player') && x.player !== 'opponent') err(c, 'ABILITY_SHAPE', `${path}.player`, 'must be "opponent" when present');
      if (Object.hasOwn(x, 'filter')) filter(c, x.filter, `${path}.filter`);
      return;
    case 'stockFromDeck':
    case 'heal':
      if (shape(c, x, path, ['do', 'count'])) count(c, x.count, `${path}.count`);
      return;
    case 'power':
    case 'soul':
      if (!shape(c, x, path, ['do', 'amount', 'target'], ['duration'])) return;
      amount(c, x.amount, `${path}.amount`, x.do === 'power' ? ABILITY_LIMITS.power : ABILITY_LIMITS.soul);
      target(c, x.target, `${path}.target`, scope);
      if (Object.hasOwn(x, 'duration') && !inList(DURATIONS, x.duration)) err(c, 'ABILITY_STEP', `${path}.duration`, 'must be turn or game');
      return;
    case 'damageOpp':
      if (shape(c, x, path, ['do', 'amount'])) count(c, x.amount, `${path}.amount`, ABILITY_LIMITS.damage);
      return;
    case 'salvage':
      if (!shape(c, x, path, ['do', 'count'], ['upTo', 'filter'])) return;
      count(c, x.count, `${path}.count`);
      upTo(c, x, path);
      if (Object.hasOwn(x, 'filter')) filter(c, x.filter, `${path}.filter`);
      return;
    case 'lookTop': {
      if (!shape(c, x, path, ['do', 'count', 'rest'], ['upTo', 'take'])) return;
      count(c, x.count, `${path}.count`, ABILITY_LIMITS.lookCount);
      upTo(c, x, path);
      if (!inList(LOOK_REST, x.rest)) err(c, 'ABILITY_STEP', `${path}.rest`, `must be one of ${LOOK_REST.join(', ')}`);
      const take = x.take;
      if (take !== undefined && shape(c, take, `${path}.take`, ['count', 'to'], ['upTo', 'filter'])) {
        count(c, take.count, `${path}.take.count`, isInt(x.count) ? Math.min(Math.max(x.count, 1), ABILITY_LIMITS.lookCount) : ABILITY_LIMITS.lookCount);
        upTo(c, take, `${path}.take`);
        if (!inList(LOOK_DESTINATIONS, take.to)) err(c, 'ABILITY_STEP', `${path}.take.to`, `must be one of ${LOOK_DESTINATIONS.join(', ')}`);
        if (Object.hasOwn(take, 'filter')) filter(c, take.filter, `${path}.take.filter`);
      }
      return;
    }
    case 'sendToWaiting':
    case 'returnToHand':
      if (shape(c, x, path, ['do', 'target'])) target(c, x.target, `${path}.target`, scope);
      return;
    case 'may': {
      if (!shape(c, x, path, ['do', 'steps'], ['then', 'else'])) return;
      const inner = new Set(scope);
      const only = Array.isArray(x.steps) && x.steps.length === 1 ? (x.steps[0] as unknown) : undefined;
      if (only === undefined) err(c, 'ABILITY_STEP', `${path}.steps`, 'must hold exactly one step');
      else if (isObj(only) && (only.do === 'may' || only.do === 'if' || Object.hasOwn(only, 'upTo'))) {
        err(c, 'ABILITY_STEP', `${path}.steps.0`, 'the optional action must be one plain step (no may, if or up to)');
      }
      steps(c, x.steps, `${path}.steps`, inner, depth + 1);
      // "If you do" sees what the optional action chose; "if you do not" does not.
      if (Object.hasOwn(x, 'then')) steps(c, x.then, `${path}.then`, inner, depth + 1);
      if (Object.hasOwn(x, 'else')) steps(c, x.else, `${path}.else`, new Set(scope), depth + 1);
      return;
    }
    case 'if':
      if (!shape(c, x, path, ['do', 'when', 'then'], ['else'])) return;
      conditions(c, x.when, `${path}.when`);
      steps(c, x.then, `${path}.then`, new Set(scope), depth + 1);
      if (Object.hasOwn(x, 'else')) steps(c, x.else, `${path}.else`, new Set(scope), depth + 1);
      return;
  }
}

function modifier(c: Ctx, x: unknown, path: string): void {
  if (!shape(c, x, path, ['stat', 'amount', 'target'])) return;
  if (x.stat !== 'power' && x.stat !== 'soul') err(c, 'ABILITY_STEP', `${path}.stat`, 'must be power or soul');
  else amount(c, x.amount, `${path}.amount`, x.stat === 'power' ? ABILITY_LIMITS.power : ABILITY_LIMITS.soul);
  if (x.target === 'this') {
    if (c.cardKind !== 'character') err(c, 'ABILITY_TARGET', `${path}.target`, '"this" is only for a character\'s own abilities');
  } else selector(c, x.target, `${path}.target`);
}

function ability(c: Ctx, x: unknown, path: string): void {
  if (!isObj(x) || !inList(ABILITY_KINDS, x.kind)) {
    err(c, 'ABILITY_KIND', `${path}.kind`, `must be one of ${ABILITY_KINDS.join(', ')}`);
    return;
  }
  switch (x.kind) {
    case 'activated':
      if (!shape(c, x, path, ['kind', 'timing', 'cost', 'effect'], ['when'])) return;
      if (c.cardKind !== 'character') err(c, 'ABILITY_KIND', path, 'only characters have activated abilities');
      if (!inList(ABILITY_TIMINGS, x.timing)) err(c, 'ABILITY_TIMING', `${path}.timing`, 'must be main or counter');
      // Every activated ability has a cost. That rules out free repetition, though a cost can still be
      // recovered by the effect (discard, then salvage), so players and the AI need their own limits.
      cost(c, x.cost, `${path}.cost`);
      if (Object.hasOwn(x, 'when')) conditions(c, x.when, `${path}.when`);
      steps(c, x.effect, `${path}.effect`, new Set(), 1);
      return;
    case 'automatic': {
      if (!shape(c, x, path, ['kind', 'trigger', 'effect'], ['cost'])) return;
      const trig = x.trigger;
      if (!isObj(trig) || !inList(TRIGGER_KINDS, trig.on)) err(c, 'ABILITY_TRIGGER', `${path}.trigger.on`, `must be one of ${TRIGGER_KINDS.join(', ')}`);
      else if (shape(c, trig, `${path}.trigger`, ['on'], trig.on === 'climaxPlayed' ? ['name'] : [])) {
        if (trig.on !== 'play' && c.cardKind !== 'character') err(c, 'ABILITY_TRIGGER', `${path}.trigger.on`, `only characters have "${String(trig.on)}" triggers`);
        if (Object.hasOwn(trig, 'name')) text(c, trig.name, `${path}.trigger.name`);
      }
      if (Object.hasOwn(x, 'cost')) cost(c, x.cost, `${path}.cost`);
      steps(c, x.effect, `${path}.effect`, new Set(), 1);
      return;
    }
    case 'continuous': {
      if (!shape(c, x, path, ['kind', 'modifiers'], ['when'])) return;
      if (Object.hasOwn(x, 'when')) conditions(c, x.when, `${path}.when`);
      const mods = list(c, x.modifiers, `${path}.modifiers`, ABILITY_LIMITS.steps);
      mods?.forEach((m, i) => modifier(c, m, `${path}.modifiers.${i}`));
      return;
    }
  }
}

/**
 * Checks a card definition's `abilities` and `effect` fields. `at` labels the
 * card in messages (e.g. "card SYN-001").
 */
export function checkCardAbilities(def: { readonly kind?: unknown; readonly abilities?: unknown; readonly effect?: unknown }, at: string): EngineError[] {
  const c: Ctx = { cardKind: def.kind, at, errors: [], names: new Set() };
  if (def.abilities !== undefined) {
    if (def.kind === 'event') err(c, 'ABILITY_KIND', 'abilities', 'an event card has an effect, not abilities');
    const items = list(c, def.abilities, 'abilities', ABILITY_LIMITS.abilities);
    items?.forEach((a, i) => {
      c.names = new Set();
      ability(c, a, `abilities.${i}`);
    });
  }
  if (def.effect !== undefined) {
    if (def.kind !== 'event') err(c, 'ABILITY_KIND', 'effect', 'only an event card has an effect');
    c.names = new Set();
    steps(c, def.effect, 'effect', new Set(), 1);
  }
  return c.errors;
}
