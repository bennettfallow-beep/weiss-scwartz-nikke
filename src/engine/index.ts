// Public surface of the rules engine. UI and other layers import from here
// only (enforced by tests/architecture/purity.test.ts).

export { hashSeed, nextInt, nextUint32, seedRng, shuffle } from './core/rng';
export type { RngState } from './core/rng';

export * from './model/types';
export { costOf, levelOf, lookupDef, powerOf, soulOf, validateCatalog } from './model/cards';
export { BACK_STAGE, behind, CENTER_STAGE, facing, inFrontOf, isCenter } from './model/stage';
export { DECK_SIZE, MAX_CLIMAX, MAX_COPIES_PER_NAME, validateDeck } from './rules/deck';
export { HAND_LIMIT, LEVEL_UP_AT, LOSING_LEVEL } from './rules/ruleActions';
export { allowedInWindow, canAfford, canPlayFromHand, meetsColor, meetsLevel } from './rules/play';
export { ENCORE_COST } from './rules/autos';
export { attackOptions, canBackup } from './rules/combat';
export type { AttackOption } from './rules/combat';
export { currentLevel, currentPower, currentSoul, playerLevel } from './rules/effects';
export { masterOf, locate, isPublicZone } from './core/zones';
export { EngineFault } from './core/fault';
export {
  actionKey,
  actor,
  applyAction,
  createGame,
  legalActions,
  normalizeAction,
  OPENING_HAND,
  replay,
  stateHash,
  validate,
} from './api/game';
export type { ApplyResult, CreateResult, ReplayResult, ValidateResult } from './api/game';
export { canSee, HIDDEN, projectEvents, projectView } from './api/view';
export type { GameView, PendingView, PlayerView, VisibleCard, VisibleStageCard } from './api/view';
export { checkInvariants } from './api/invariants';

/** The rules document this engine implements. See docs/RULES_SOURCE.md. */
export const RULES_SOURCE = {
  document: 'Weiss Schwarz (English Edition) Comprehensive Rules',
  version: '2.10',
  lastUpdated: '2025-09-17',
} as const;
