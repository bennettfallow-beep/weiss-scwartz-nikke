// Public surface of the card layer: the card-set file format, its importer,
// decklists and feature coverage. Other layers import from here only.

export { CARD_NUMBER, CardRecordSchema, cardSetJsonSchema, CardSetFileSchema, HTTPS_URL, SCHEMA_VERSION } from './schema';
export type { CardRecord, CardSetFile } from './schema';
export { exportCardSet, importCardSet, importCardSetData, IMPORT_ISSUE_CODES, MAX_CARD_DEPTH, MAX_FILE_CHARS, MAX_ISSUES } from './importer';
export type { CardDisplay, ImportIssue, ImportIssueCode, ImportOptions, ImportResult } from './importer';
export { DECKLIST_ISSUE_CODES, formatDecklist, MAX_DECKLIST_CHARS, parseDecklist } from './decklist';
export type { DecklistIssue, DecklistResult } from './decklist';
export { allFeatures, featuresOf, missingFeatures } from './coverage';
export { isNormalName, nameProblem, normalizeCardText, normalizeName } from './text';
export { loadSyn, SYN_DECK_NAMES } from './syn';
export type { StarterSet, SynDeckName } from './syn';
