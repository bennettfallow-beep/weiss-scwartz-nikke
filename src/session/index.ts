// Public surface of the session layer: running one game for the app. The UI
// imports from here only, and reads only the screen models (no game state).

export type { CardSource, GameRecord, Memory, Mode, Seat, Session, SessionError, SessionErrorCode, SessionResult } from './types';
export { starterCards } from './cards';
export { canonicalJson, catalogFingerprint, fingerprint } from './canonical';
export {
  acceptHandoff,
  botToMove,
  canUndo,
  choose,
  concede,
  cover,
  humanSeat,
  needsHandoff,
  newGame,
  stepBot,
  toAct,
  undo,
  viewer,
} from './session';
export type { NewGameOptions } from './session';
export { buildScreen, cardDetail, gameOverScreen, handoffScreen, logFor, mulliganChoice, screenFor } from './screen';
export type { GameOverModel, HandoffModel, Screen, Side, SlotView } from './screen';
export type { Choice, ChoiceGroup, Prompt } from './prompt';
export type { LogLine } from './log';
export type { CardDetail, CardTile, StageTile } from './tiles';
export { checkReplay, exportReplay, loadSave, MAX_SAVE_CHARS, normalizeSave, parseSave, REPLAY_FORMAT, SAVE_ERROR_CODES, SAVE_FORMAT, SAVE_VERSION, toSave } from './save';
export type { LoadOptions, Migration, NormalizeOptions, ReplayV1, SaveError, SaveErrorCode, SaveV1 } from './save';
