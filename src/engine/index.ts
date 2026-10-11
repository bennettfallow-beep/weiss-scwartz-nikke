// Public surface of the rules engine. UI and other layers import from here
// only (enforced by tests/architecture/purity.test.ts).

export { hashSeed, nextInt, nextUint32, seedRng, shuffle } from './core/rng';
export type { RngState } from './core/rng';

/** The rules document this engine implements. See docs/RULES_SOURCE.md. */
export const RULES_SOURCE = {
  document: 'Weiss Schwarz (English Edition) Comprehensive Rules',
  version: '2.10',
  lastUpdated: '2025-09-17',
} as const;
