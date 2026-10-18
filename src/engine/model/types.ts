// Core data model. Everything here is plain JSON-serializable data so a game
// can be saved, replayed and diffed. Zone arrays are ordered bottom -> top:
// the LAST element is the top card (deck top, newest waiting-room card, ...).

import type { RngState } from '../core/rng';
import type { Ability, CostPart, LookTake, Step, TriggerKind, StepKind } from './abilities';

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

/** CR 4.12.2. Carried out in the Trigger Step (CR 7.3). */
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
export const TRIGGER_ICONS: readonly TriggerIcon[] = ['soul', 'return', 'pool', 'comeback', 'draw', 'shot', 'treasure', 'gate', 'standby', 'choice'];

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
  /** Counter icon (CR 2.8.2). On an event: playable in the opponent's Counter Step. */
  readonly counter?: boolean;
  /**
   * Backup (CR 10.5), a counter-icon ability used from hand in the opponent's
   * Counter Step. Its cost is `stock` stock cards and then this card from hand
   * to the waiting room (the usual printed cost); `level` is the minimum level.
   */
  readonly backup?: { readonly power: number; readonly level: number; readonly stock: number };
  /** Abilities of a character or climax (CR 8.1). */
  readonly abilities?: readonly Ability[];
  /** What an event card does when it resolves (CR 8.6.2.5.2). */
  readonly effect?: readonly Step[];
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

/** Timing words that automatic abilities can key on (card abilities arrive in M3). */
export type TriggerCondition =
  | 'turnStart'
  | 'standPhaseStart'
  | 'drawPhaseStart'
  | 'clockPhaseStart'
  | 'mainPhaseStart'
  | 'climaxPhaseStart'
  | 'attackPhaseStart'
  | 'attackDeclarationStart'
  | 'triggerStepStart'
  | 'counterStepStart'
  | 'damageStepStart'
  | 'battleStepStart'
  | 'attackEnd'
  | 'encoreStepStart'
  | 'turnEnd';

export type InterruptKind = 'refresh' | 'levelUp';
export type PlayWindow = 'main' | 'climax' | 'counter';

// --- Combat (CR 7) -----------------------------------------------------------

/** Steps of the Attack Phase. One Attack Sub-Phase runs declaration -> trigger -> (counter) -> damage -> (battle). */
export type AttackStep = 'declaration' | 'trigger' | 'counter' | 'damage' | 'battle' | 'encore';
export type AttackType = 'direct' | 'frontal' | 'side';
export const ATTACK_TYPES: readonly AttackType[] = ['direct', 'frontal', 'side'];

/** A specific card object: a card id plus its object identity (epoch) at the time. */
export interface CardRef {
  card: CardId;
  epoch: number;
}

/** The current Attack Sub-Phase (CR 7.1.2). Fixed once the attack type is chosen (CR 7.2.1.4.3). */
export interface AttackState {
  type: AttackType;
  /** The attacking character as declared, and the stage position it attacked from. */
  attacker: CardRef;
  slot: Slot;
  /** The character facing the attacker at declaration (frontal or side), and its position. Null for a direct attack. */
  facing: CardRef | null;
  facingSlot: Slot | null;
}

/** The card being trigger-checked (CR 7.3.1.2) and the icons it had when it entered the resolution zone. */
export interface TriggerCheckState {
  player: PlayerId;
  card: CardRef;
  remaining: TriggerIcon[];
}

/** A damage process in progress (CR 4.10). */
export interface DamageState {
  target: PlayerId;
  amount: number;
  source: CardRef | null;
  /** Cards this process has put in the resolution zone, in order. */
  cards: CardId[];
}

/**
 * A power or soul change from a one-shot effect. It applies to one card object
 * only (CR 8.9.2) and lasts until end of turn (CR 6.8.1.4), or, with `until:
 * 'game'`, for as long as the card stays where it is (CR 8.2.1.2).
 */
export interface TurnEffect {
  card: CardRef;
  stat: 'power' | 'soul';
  amount: number;
  until?: 'game';
}

/** Shot (CR 4.12.2.7): waits for the next damage dealt by this character to be canceled, this turn. */
export interface ShotWatcher {
  player: PlayerId;
  source: CardRef;
}

/**
 * An automatic ability in standby (CR 8.7.2), waiting for a check timing.
 * Encore is the rule-level keyword every character has (CR 10.2.3).
 */
export type StandbyAuto =
  | { id: number; ability: 'encore'; player: PlayerId; card: CardRef; slot: Slot; cost: number }
  | { id: number; ability: 'shot'; player: PlayerId; source: CardRef }
  /** A card's own automatic ability: `index` into its definition's abilities. */
  | { id: number; ability: 'card'; player: PlayerId; source: CardRef; index: number; on: TriggerKind };

// --- Abilities in progress (M3) -------------------------------------------------

/** One unit of work in an ability being resolved. */
export type FrameOp =
  | { k: 'step'; step: Step; forced?: true; ifDone?: IfDone }
  /** Automatic ability with an optional cost: ask whether to pay. */
  | { k: 'offerCost' }
  /** Choose the cards a discard cost will put into the waiting room. */
  | { k: 'pickCost' }
  | { k: 'payCost' }
  /** CR 8.6.2.4: the ability counts as played once its cost is paid. */
  | { k: 'played' }
  /** "Up to N": before each card the player may stop (CR 3.2.3.1). */
  | { k: 'drawMore'; player: PlayerId; left: number }
  | { k: 'lookMore'; left: number }
  | { k: 'lookTake'; take: LookTake }
  | { k: 'lookRest'; rest: 'top' | 'bottom' | 'waiting' };

/**
 * The rest of a "you may" whose action is a pick among hidden cards: whether
 * the action was done is known only once `count` cards have been picked or not.
 */
export interface IfDone {
  count: number;
  then?: readonly Step[];
  else?: readonly Step[];
}

/** What the open prompt of a frame is for. */
export type FrameWait =
  | { for: 'target'; as: string }
  | { for: 'costCards' }
  | { for: 'move'; to: 'hand' | 'stock' | 'waiting'; reason: MoveReason; ifDone?: IfDone }
  | { for: 'order'; where: 'top' | 'bottom' }
  | { for: 'payCost' }
  | { for: 'may'; step: Extract<Step, { do: 'may' }> }
  | { for: 'drawMore'; player: PlayerId; left: number }
  | { for: 'lookMore'; left: number };

/** The ability or event effect being resolved. Only one resolves at a time. */
export interface AbilityFrame {
  kind: 'event' | 'activated' | 'automatic';
  /** CR 4.3.3-4.3.5: whoever "you" means in the text. */
  master: PlayerId;
  /** The card with the ability (for an event, the event card itself). */
  source: CardRef;
  def: string;
  /** Index into the definition's abilities, or null for an event's effect. */
  index: number | null;
  /** The ability's cost, copied from the card when the frame opened. */
  cost: CostPart[];
  ops: FrameOp[];
  /** Cards picked by `choose` steps, by name. */
  chosen: { as: string; cards: CardRef[] }[];
  /** Cards chosen to pay a discard cost. */
  costCards: CardId[];
  /** Cards the master is looking at (CR 4.8); only they see them. */
  look: { player: PlayerId; cards: CardRef[] } | null;
  wait: FrameWait | null;
}

export type PickPurpose = 'target' | 'costDiscard' | 'discard' | 'salvage' | 'lookTake' | 'orderTop' | 'orderBottom';
export type OptionalPurpose = 'payCost' | 'may' | 'drawMore' | 'lookMore';

/** One card's zone change, with the card's new object identity. */
export interface ZoneChange {
  card: CardId;
  epoch: number;
  from: ZoneRef;
  to: ZoneRef;
}

export type ChooseReason = 'return' | 'comeback' | 'gate' | 'standby' | 'choice' | 'encoreStep';
export type ConfirmReason = 'pool' | 'draw' | 'treasure';
export type Destination = 'hand' | 'stock';

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
  | { t: 'startTurn' }
  /** CR 8.6.2.4: the card counts as played once its cost is paid. */
  | { t: 'played'; player: PlayerId; card: CardId }
  /** CR 8.6.2.5: the played card resolves. `slot` is the chosen stage position for a character. */
  | { t: 'resolveCard'; player: PlayerId; card: CardId; slot?: Slot }
  /** Enter an Attack Phase step. `first` marks the turn's first Attack Declaration Step (CR 7.2.1.1). */
  | { t: 'step'; step: AttackStep; first?: boolean }
  | { t: 'attackDecision' }
  | { t: 'triggerCheck' }
  | { t: 'nextIcon' }
  | { t: 'icon'; icon: TriggerIcon }
  | { t: 'triggerToStock' }
  | { t: 'attackDamage' }
  | { t: 'battle' }
  | { t: 'attackEnd' }
  | { t: 'endSubPhase' }
  | { t: 'encoreLoop' }
  | { t: 'encoreEnd' }
  /** Starts a damage process (CR 4.10). */
  | { t: 'damage'; target: PlayerId; amount: number; source: CardRef | null }
  | { t: 'damageReveal' }
  | { t: 'damageCheck' }
  /** Plays and resolves one standby automatic ability (CR 8.5.1.2). */
  | { t: 'auto'; id: number }
  /** CR 6.8.1.4: "until end of turn" effects stop applying. */
  | { t: 'expireEffects' }
  /** Runs the next op of the ability being resolved. */
  | { t: 'frame' }
  /** CR 8.6.2.5.2: the resolved event goes to its owner's waiting room. */
  | { t: 'eventDone'; card: CardRef }
  /** Moves one card for an effect, if it is still the same object. */
  | { t: 'fxMove'; card: CardRef; to: 'hand' | 'stock' | 'waiting'; reason: MoveReason }
  /** Moves the top card of a player's deck or clock for an effect. */
  | { t: 'fxTop'; player: PlayerId; from: 'deck' | 'clock'; to: 'stock' | 'waiting' };

/** The single decision the game is waiting for. */
export type Pending =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'clock'; player: PlayerId }
  | { kind: 'play'; player: PlayerId; window: PlayWindow }
  | { kind: 'levelUp'; player: PlayerId; options: CardId[] }
  | { kind: 'interruptOrder'; player: PlayerId; options: InterruptKind[] }
  /**
   * End-of-turn hand limit (CR 6.8.1.2): choose `count` cards one CHOOSE_CARD at a time; once all
   * are chosen they go to the waiting room together, in the order chosen.
   */
  | { kind: 'discard'; player: PlayerId; count: number; picked: CardId[] }
  /** Attack Declaration Step: attack with a character, or PASS to end the Attack Phase (CR 7.2.1.3). */
  | { kind: 'attack'; player: PlayerId }
  /** The trigger card has several different icons left; pick which to carry out next (CR 7.3.1.2.1). */
  | { kind: 'iconOrder'; player: PlayerId; icons: TriggerIcon[] }
  /** Choose one of `options`; PASS declines when `optional`. */
  | { kind: 'choose'; player: PlayerId; reason: ChooseReason; options: CardId[]; optional: boolean }
  /** Standby icon, second half: the stage position for the chosen character. */
  | { kind: 'chooseSlot'; player: PlayerId; card: CardId; options: Slot[] }
  /** Choice icon, second half: hand or stock for the chosen character. */
  | { kind: 'chooseDest'; player: PlayerId; card: CardId; options: Destination[] }
  /** An optional yes/no trigger action: ACCEPT or PASS. */
  | { kind: 'confirm'; player: PlayerId; reason: ConfirmReason }
  /** Encore: ACCEPT pays the cost and returns the card to `slot` rested; PASS declines (CR 10.2.2). */
  | { kind: 'encore'; player: PlayerId; card: CardId; slot: Slot; cost: number }
  /** Several of this player's automatic abilities are in standby; pick which to play first (CR 8.7.3). */
  | { kind: 'autoOrder'; player: PlayerId; options: StandbyAuto[] }
  /**
   * An ability asks for cards, one CHOOSE_CARD at a time. PASS ends the choice
   * once at least `min` are picked. `card` is the card whose ability asks. A `target` pick
   * also gives `as`, the name later steps of the ability use for the chosen cards.
   */
  | { kind: 'pick'; player: PlayerId; purpose: PickPurpose; card: CardId; options: CardId[]; picked: CardId[]; min: number; max: number; as?: string }
  /** An ability asks a yes/no question: ACCEPT or PASS. */
  | { kind: 'optional'; player: PlayerId; purpose: OptionalPurpose; card: CardId };

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
  | { type: 'ATTACK'; player: PlayerId; slot: Slot; attack: AttackType }
  | { type: 'BACKUP'; player: PlayerId; card: CardId }
  | { type: 'ORDER_ICON'; player: PlayerId; icon: TriggerIcon }
  | { type: 'CHOOSE_CARD'; player: PlayerId; card: CardId }
  | { type: 'CHOOSE_SLOT'; player: PlayerId; slot: Slot }
  | { type: 'CHOOSE_DEST'; player: PlayerId; dest: Destination }
  | { type: 'ACCEPT'; player: PlayerId }
  | { type: 'ORDER_AUTO'; player: PlayerId; auto: number }
  /** Use an activated ability: `ability` indexes the card definition's abilities. */
  | { type: 'ACTIVATE'; player: PlayerId; card: CardId; ability: number }
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
  | 'triggerCheck'
  | 'triggerToStock'
  | 'icon'
  | 'damage'
  | 'damageCancel'
  | 'damageToClock'
  | 'encoreStep'
  | 'encore'
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
  | { kind: 'gameOver'; result: GameResult }
  | { kind: 'step'; step: AttackStep }
  | { kind: 'attack'; player: PlayerId; card: CardId; slot: Slot; attack: AttackType; facing: CardId | null }
  | { kind: 'triggerCheck'; player: PlayerId; card: CardId; icons: TriggerIcon[] }
  | { kind: 'icon'; player: PlayerId; icon: TriggerIcon }
  | { kind: 'modifier'; card: CardId; stat: 'power' | 'soul'; amount: number }
  | { kind: 'damage'; target: PlayerId; amount: number; source: CardId | null }
  | { kind: 'damageCanceled'; target: PlayerId; source: CardId | null; cards: CardId[] }
  | { kind: 'damageTaken'; target: PlayerId; source: CardId | null; cards: CardId[] }
  | { kind: 'battle'; attacker: CardId; defender: CardId; reversed: CardId[] }
  | { kind: 'auto'; player: PlayerId; ability: StandbyAuto['ability']; card: CardId }
  | { kind: 'backup'; player: PlayerId; card: CardId; target: CardId | null; power: number }
  | { kind: 'effectsExpired' }
  /** An ability or event effect was played (CR 8.6.2.4). */
  | { kind: 'ability'; player: PlayerId; card: CardId; index: number | null; category: AbilityFrame['kind'] }
  /** A standby automatic ability could not be played and was used up (CR 8.7.3.2). */
  | { kind: 'abilityLapsed'; player: PlayerId; card: CardId; index: number }
  | { kind: 'effect'; player: PlayerId; card: CardId; op: StepKind }
  | { kind: 'optional'; player: PlayerId; card: CardId; purpose: OptionalPurpose; accepted: boolean }
  /** Characters picked by a choose step (stage cards, so public). */
  | { kind: 'chosen'; player: PlayerId; card: CardId; cards: CardId[] }
  /** The player looks at these deck cards; only they see which (CR 4.8). */
  | { kind: 'look'; player: PlayerId; cards: CardId[] }
  | { kind: 'lookEnd'; player: PlayerId }
  /** Looked-at cards were put back on top or at the bottom in a chosen order. */
  | { kind: 'deckArranged'; player: PlayerId; top: number; bottom: number };

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
  /** Current Attack Phase step, or null outside the Attack Phase. */
  step: AttackStep | null;
  /** Attack Sub-Phases started this turn (CR 7.2.1.3.1.2 limits the starting player's first turn to one). */
  attacks: number;
  attack: AttackState | null;
  triggerCheck: TriggerCheckState | null;
  damage: DamageState | null;
  /** "Until end of turn" changes (CR 6.8.1.4). */
  effects: TurnEffect[];
  watchers: ShotWatcher[];
  standby: StandbyAuto[];
  /** Zone changes not yet checked for trigger conditions; emptied at each check timing. */
  moved: ZoneChange[];
  /** The ability or event effect being resolved, if any. */
  resolving: AbilityFrame | null;
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
  /** Where in the input the problem is, e.g. "abilities.0.effect.1.count". */
  readonly path?: string;
}
