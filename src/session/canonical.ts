// Canonical JSON and short fingerprints, for saves and catalog identity.

import { hashSeed } from '../engine';
import type { CardCatalog } from '../engine';

/** JSON with object keys sorted and undefined fields left out, so equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v: unknown) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 32 hex characters identifying `value` (cyrb128 over its canonical JSON; not a security hash). */
export function fingerprint(value: unknown): string {
  return hashSeed(canonicalJson(value))
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

/** Identifies a card catalog, so a save is only continued with the cards it was played with. */
export function catalogFingerprint(catalog: CardCatalog): string {
  return fingerprint(catalog);
}
