// Core data model. Everything here is plain JSON-serializable data so a game
// can be saved, replayed and diffed. Zone arrays are ordered bottom -> top:
// the LAST element is the top card (deck top, newest waiting-room card, ...).

import type { RngState } from '../core/rng';

export type PlayerId = 0 | 1;
export const PLAYERS: readonly PlayerId[] = [0, 1];
export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

// --- Card definitions (catalog) ---------------------------------------------

export type Color = 'yellow' | 'green' | 'red' | 'blue';
export const COLORS: readonly Color[] = ['yellow', 'green', 'red', 'blue'];

/** CR 2.3.2: every card is exactly one of these. */
export type CardKind = 'character' | 'event' | 'climax';
export const CARD_KINDS: readonly CardKind[] = ['character', 'event', 'climax'];

/** CR 4.12.2. Resolved in the Trigger Step (M2). */
export type TriggerIcon =
  | 'soul'
  | 'return'
  | 'pool'
  | 'comeback'
  | 'draw'
  | 'shot'
  | 'treasure'
  | 'gate'
  | 'standby'
  | 'choice';

/**
 * A card definition. `name` is the rules name (CR 2.1.1): reading aids and
 * struck-through text are not part of it, so card data must store the name
 * without them. Level and cost exist only on characters and events, power and
 * soul only on characters (CR 2.6-2.10); see validateCatalog.
 */
export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly kind: CardKind;
  readonly color: Color;
  readonly level?: number;
  readonly cost?: number;
  readonly power?: number;
  readonly soul?: number;
  readonly traits?: readonly string[];
  readonly triggers?: readonly TriggerIcon[];
  /** Counter icon (CR 2.8.2). */
  readonly counter?: boolean;
}

export type CardCatalog = Readonly<Record<string, CardDef>>;

// --- Zones -------------------------------------------------------------------

export type CardId = string;

export type ZoneName =
  | 'deck'
  | 'hand'
  | 'waiting'
  | 'clock'
  | 'level'
  | 'stock'
  | 'memory'
  | 'resolution'
  | 'stage'
  | 'climax';

/** Stage positions as numbered in CR 3.6: 1-3 center stage (left to right), 4-5 back stage. */
export type Slot = 1 | 2 | 3 | 4 | 5;
export const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5];

/** CR 4.6.1. Only characters on the stage have an orientation. */
export type Orientation = 'stand' | 'rest' | 'reverse';

export interface ZoneRef {
  readonly player: PlayerId;
  readonly zone: ZoneName;
  readonly slot?: Slot;
}

export interface StageCard {
  id: CardId;
  orientation: Orientation;
  /** Monotonic placement stamp; ILL-02 keeps only the most recently placed card. */
  placedAt: number;
}

export interface PlacedCard {
  id: CardId;
  placedAt: number;
}

export interface PlayerState {
  deck: CardId[];
  hand: CardId[];
  waiting: CardId[];
  clock: CardId[];
  level: CardId[];
  stock: CardId[];
  memory: CardId[];
  resolution: CardId[];
  /** Index i holds stage position i + 1. Normally 0 or 1 card; extras are removed by rule action (CR 9.6.2). */
  stage: StageCard[][];
  /** Normally 0 or 1 card (CR 3.11.2). */
  climax: PlacedCard[];
  mulliganDone: boolean;
}

export interface CardInstance {
  readonly id: CardId;
  readonly def: string;
  /** CR 4.2: the player whose deck held the card at the start of the game. */
  readonly owner: PlayerId;
  /**
   * Object identity (CR 3.1.4): bumped on every zone change except a move
   * between stage positions, so effects applied to the old object stop applying.
   */
  epoch: number;
}

// --- Flow --------------------------------------------------------------------

export type Phase = 'setup' | 'stand' | 'draw' | 'clock' | 'main' | 'climax' | 'attack' | 'end' | 'gameOver';
export type TurnPhase = Exclude<Phase, 'setup' | 'gameOver'>;

/** Timing words that automatic abilities can key on (abilities arrive in M3). */
export type TriggerCondition =
  | 'turnStart'
  | 'standPhaseStart'
  | 'drawPhaseStart'
  | 'clockPhaseStart'
  | 'mainPhaseStart'
  | 'climaxPhaseStart'
  | 'turnEnd';

export type InterruptKind = 'refresh' | 'levelUp';
export type PlayWindow = 'main' | 'climax';

/** Engine work queue. Serializable so a game can stop at any decision and resume. */
export type Task =
  | { t: 'phase'; phase: TurnPhase }
  | { t: 'trigger'; condition: TriggerCondition }
  /** One check timing. `again` marks a repeat pass within the same check timing (CR 8.5.1.1). */
  | { t: 'check'; mark?: 'endPhase'; again?: boolean }
  | { t: 'draw'; player: PlayerId }
  | { t: 'standAll' }
  | { t: 'mulligan'; player: PlayerId }
  | { t: 'clockDecision' }
  | { t: 'playTiming'; window: PlayWindow; checked: boolean }
  | { t: 'handLimit' }
  | { t: 'climaxCleanup' }
  | { t: 'endOfTurn' }
  | { t: 'startTurn' };

/** The single decision the game is waiting for. */
export type Pending =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'clock'; player: PlayerId }
  | { kind: 'play'; player: PlayerId; window: PlayWindow }
  | { kind: 'levelUp'; player: PlayerId; options: CardId[] }
  | { kind: 'interruptOrder'; player: PlayerId; options: InterruptKind[] }
  | { kind: 'discard'; player: PlayerId; count: number };

export type Action =
  | { type: 'MULLIGAN'; player: PlayerId; discard: CardId[] }
  | { type: 'CLOCK'; player: PlayerId; card: CardId | null }
  | { type: 'PLAY_CHARACTER'; player: PlayerId; card: CardId; slot: Slot }
  | { type: 'PLAY_EVENT'; player: PlayerId; card: CardId }
  | { type: 'PLAY_CLIMAX'; player: PlayerId; card: CardId }
  | { type: 'SWAP'; player: PlayerId; a: Slot; b: Slot }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'LEVEL_UP'; player: PlayerId; card: CardId }
  | { type: 'CHOOSE_INTERRUPT'; player: PlayerId; interrupt: InterruptKind }
  | { type: 'DISCARD'; player: PlayerId; cards: CardId[] }
  /** Owners may reorder their own hand and waiting room at any time (CR 3.3.2, 3.4.2). */
  | { type: 'REORDER'; player: PlayerId; zone: 'hand' | 'waiting'; order: CardId[] }
  /** Any player may concede at any time (CR 1.2.4). */
  | { type: 'CONCEDE'; player: PlayerId };

export type LossReason = 'level4' | 'deckOut' | 'concede';

export type GameResult =
  | { kind: 'win'; winner: PlayerId; loser: PlayerId; reason: LossReason }
  | { kind: 'draw'; reasons: [LossReason, LossReason] };

export type RuleActionKind = 'loss' | 'insufficientPower' | 'illegalCard' | 'extraCards';

export type MoveReason =
  | 'draw'
  | 'mulligan'
  | 'clock'
  | 'cost'
  | 'play'
  | 'eventResolved'
  | 'refresh'
  | 'refreshClock'
  | 'levelUp'
  | 'ruleAction'
  | 'handLimit'
  | 'climaxCleanup'
  | 'swap'
  | 'effect';

export type EventBody =
  | { kind: 'setup'; starting: PlayerId }
  | { kind: 'shuffle'; player: PlayerId }
  | { kind: 'move'; card: CardId; from: ZoneRef; to: ZoneRef; reason: MoveReason }
  | { kind: 'turnStart'; player: PlayerId }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'trigger'; condition: TriggerCondition }
  | { kind: 'checkTiming' }
  | { kind: 'playTiming'; player: PlayerId; window: PlayWindow }
  | { kind: 'action'; action: Action }
  | { kind: 'played'; player: PlayerId; card: CardId }
  | { kind: 'orientation'; card: CardId; orientation: Orientation }
  | { kind: 'refresh'; player: PlayerId }
  | { kind: 'ruleAction'; rule: RuleActionKind; cards: CardId[]; players: PlayerId[] }
  | { kind: 'gameOver'; result: GameResult };

export type GameEvent = { seq: number; turn: number; phase: Phase } & EventBody;
export type EventKind = GameEvent['kind'];

export interface GameState {
  schema: 1;
  rulesVersion: '2.10';
  seed: string;
  rng: RngState;
  cards: Record<CardId, CardInstance>;
  players: [PlayerState, PlayerState];
  starting: PlayerId;
  /** The turn player. */
  active: PlayerId;
  turn: number;
  phase: Phase;
  tasks: Task[];
  pending: Pending | null;
  result: GameResult | null;
  flags: { endCheckResolved: boolean };
  /** Monotonic counter for events and stage/climax placement stamps. */
  seq: number;
  log: GameEvent[];
}

export interface GameSetup {
  readonly seed: string;
  /** Card definition ids, 50 per deck. */
  readonly decks: readonly [readonly string[], readonly string[]];
}

export interface EngineError {
  readonly code: string;
  readonly message: string;
}
