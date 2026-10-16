// Card information accessors and catalog validation.

import { checkCardAbilities } from './abilityCheck';
import { CARD_KINDS, COLORS, TRIGGER_ICONS } from './types';
import type { CardCatalog, CardDef, EngineError } from './types';

/**
 * Looks up a definition by id. Uses an own-property check so names like
 * "toString" or "__proto__" never count as cards.
 */
export function lookupDef(catalog: CardCatalog, id: string): CardDef | undefined {
  return Object.hasOwn(catalog, id) ? catalog[id] : undefined;
}

/** CR 2.19.1: missing numeric information reads as 0 (e.g. a climax's level). */
export function levelOf(def: CardDef): number {
  return def.level ?? 0;
}
export function costOf(def: CardDef): number {
  return def.cost ?? 0;
}
export function powerOf(def: CardDef): number {
  return def.power ?? 0;
}
export function soulOf(def: CardDef): number {
  return def.soul ?? 0;
}

function isNonNegativeInt(x: unknown): boolean {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

/**
 * Checks that every definition is well formed for the rules engine:
 * one of the three card types, a known color, level/cost only on characters
 * and events, power/soul only on characters (CR 2.3-2.10).
 */
export function validateCatalog(catalog: CardCatalog): EngineError[] {
  const errors: EngineError[] = [];
  for (const [key, def] of Object.entries(catalog)) {
    const at = `card ${key}`;
    if (def.id !== key) errors.push({ code: 'CATALOG_ID', message: `${at}: id "${def.id}" does not match its key` });
    if (typeof def.name !== 'string' || def.name.trim() === '') errors.push({ code: 'CATALOG_NAME', message: `${at}: missing name` });
    if (!CARD_KINDS.includes(def.kind)) errors.push({ code: 'CATALOG_KIND', message: `${at}: kind must be character, event or climax` });
    if (!COLORS.includes(def.color)) errors.push({ code: 'CATALOG_COLOR', message: `${at}: unknown color "${String(def.color)}"` });

    const has = (field: 'level' | 'cost' | 'power' | 'soul') => def[field] !== undefined;
    const needs = (field: 'level' | 'cost' | 'power' | 'soul') => {
      if (!has(field)) errors.push({ code: 'CATALOG_MISSING', message: `${at}: ${def.kind} needs ${field}` });
      else if (!isNonNegativeInt(def[field])) errors.push({ code: 'CATALOG_RANGE', message: `${at}: ${field} must be a whole number >= 0` });
    };
    const forbids = (field: 'level' | 'cost' | 'power' | 'soul') => {
      if (has(field)) errors.push({ code: 'CATALOG_FIELD', message: `${at}: a ${def.kind} has no ${field}` });
    };

    if (def.kind === 'character') {
      needs('level');
      needs('cost');
      needs('power');
      needs('soul');
    } else if (def.kind === 'event') {
      needs('level');
      needs('cost');
      forbids('power');
      forbids('soul');
    } else if (def.kind === 'climax') {
      forbids('level');
      forbids('cost');
      forbids('power');
      forbids('soul');
    }
    if (def.level !== undefined && isNonNegativeInt(def.level) && def.level > 3) {
      errors.push({ code: 'CATALOG_RANGE', message: `${at}: level must be 0-3` });
    }
    // CR 4.12.2: trigger icons come from a closed set. Anything else would reach the trigger step as an icon nobody can resolve.
    const triggers: unknown = def.triggers;
    if (triggers !== undefined && (!Array.isArray(triggers) || !triggers.every((t) => TRIGGER_ICONS.includes(t as never)))) {
      errors.push({ code: 'CATALOG_TRIGGER', message: `${at}: triggers must be a list of trigger icons (${TRIGGER_ICONS.join(', ')})` });
    }
    if (def.counter !== undefined && typeof def.counter !== 'boolean') errors.push({ code: 'CATALOG_FIELD', message: `${at}: counter must be true or false` });
    // CR 2.5.1: only characters have traits.
    const traits: unknown = def.traits;
    if (traits !== undefined) {
      if (def.kind !== 'character') errors.push({ code: 'CATALOG_FIELD', message: `${at}: only characters have traits` });
      if (!Array.isArray(traits) || traits.length > 8 || !traits.every((t) => typeof t === 'string' && t.trim() !== '' && t.length <= 40)) {
        errors.push({ code: 'CATALOG_FIELD', message: `${at}: traits must be a list of up to 8 names` });
      }
    }
    errors.push(...checkCardAbilities(def, at));
    if (def.backup !== undefined) {
      const b = def.backup as Partial<Record<'power' | 'level' | 'stock', unknown>> | null;
      if (def.kind !== 'character') errors.push({ code: 'CATALOG_FIELD', message: `${at}: only characters have Backup` });
      if (typeof b !== 'object' || b === null || !isNonNegativeInt(b.power) || !isNonNegativeInt(b.level) || !isNonNegativeInt(b.stock)) {
        errors.push({ code: 'CATALOG_RANGE', message: `${at}: backup needs whole numbers >= 0 for power, level and stock` });
      }
    }
  }
  return errors;
}
