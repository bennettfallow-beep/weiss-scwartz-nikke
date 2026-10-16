// The card ability language (M3). Abilities are plain data in a card's
// definition, interpreted by the engine with a closed set of cases: card data
// never contains code, so imported card sets are safe to load.
//
// The language is deliberately small (docs/PLAN.md "Engine design"):
//   triggers  play, attack, reversed, climaxPlayed
//   timings   main, counter (activated abilities)
//   effects   choose, draw, discard, stockFromDeck, heal, power, soul,
//             damageOpp, salvage, lookTop, sendToWaiting, returnToHand,
//             plus `may` and `if` for optional and conditional parts
//   costs     stock, discard, rest this card, put this card into the waiting room
//   conditions level, climax, count, turn
// Anything outside it is listed in docs/KNOWN_GAPS.md.

import type { CardKind, Color } from './types';

/** "You" is the ability's master (CR 4.3.3); "opponent" is the other player. */
export type Side = 'you' | 'opponent';
export const SIDES: readonly Side[] = ['you', 'opponent'];

export const ABILITY_KINDS = ['activated', 'automatic', 'continuous'] as const;
export const ABILITY_TIMINGS = ['main', 'counter'] as const;
export const TRIGGER_KINDS = ['play', 'attack', 'reversed', 'climaxPlayed'] as const;
export const STEP_KINDS = [
  'choose',
  'draw',
  'discard',
  'stockFromDeck',
  'heal',
  'power',
  'soul',
  'damageOpp',
  'salvage',
  'lookTop',
  'sendToWaiting',
  'returnToHand',
  'may',
  'if',
] as const;
export const COST_KINDS = ['stock', 'discard', 'rest', 'selfToWaiting'] as const;
export const CONDITION_KINDS = ['level', 'climax', 'count', 'turn'] as const;
export const COUNT_ZONES = ['stage', 'climax', 'hand', 'waiting', 'clock', 'level', 'stock'] as const;
export const DURATIONS = ['turn', 'game'] as const;
export const LOOK_DESTINATIONS = ['hand', 'stock', 'waiting'] as const;
export const LOOK_REST = ['top', 'bottom', 'waiting'] as const;

export type AbilityKind = (typeof ABILITY_KINDS)[number];
export type AbilityTiming = (typeof ABILITY_TIMINGS)[number];
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export type StepKind = (typeof STEP_KINDS)[number];
export type CostKind = (typeof COST_KINDS)[number];
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export type CountZone = (typeof COUNT_ZONES)[number];
/** 'turn' ends at the end of this turn (CR 6.8.1.4); 'game' has no stated duration (CR 8.2.1.2). */
export type Duration = (typeof DURATIONS)[number];

/**
 * Tests on card information. Every field present must match. A missing piece
 * of information never matches a value (CR 2.19), so a card without traits
 * fails any trait test.
 */
export interface CardFilter {
  readonly kind?: CardKind;
  /** The exact rules name (CR 2.1.2). */
  readonly name?: string;
  readonly trait?: string;
  readonly color?: Color;
  readonly level?: { readonly min?: number; readonly max?: number };
}

/**
 * Characters on a stage (CR 2.3.2.1.2: "character" with no zone named means a
 * character on the stage).
 */
export interface Selector extends Omit<CardFilter, 'kind'> {
  readonly side: Side;
  /** Not the card that has the ability ("your other characters"). */
  readonly other?: true;
  /** The current attack's attacking or defending character. */
  readonly role?: 'attacker' | 'defender';
}

/**
 * What a count condition counts. With no zone named, characters are counted on
 * the stage (CR 2.3.2.1.2) and climaxes in the climax area (CR 2.3.2.3.2).
 */
export interface CountSpec extends CardFilter {
  readonly side: Side;
  readonly zone?: CountZone;
}

export type Condition =
  /** The player's level: the number of cards in their level zone. */
  | { readonly if: 'level'; readonly side?: Side; readonly min?: number; readonly max?: number }
  /** A climax (optionally with this name) is in the player's climax area. */
  | { readonly if: 'climax'; readonly side?: Side; readonly name?: string }
  | { readonly if: 'count'; readonly what: CountSpec; readonly min?: number; readonly max?: number }
  /** "During your turn" / "during your opponent's turn". */
  | { readonly if: 'turn'; readonly side: Side };

/** One part of a cost (CR 8.4). Parts are paid in the order written (CR 8.4.2.1). */
export type CostPart =
  /** Put exactly this many cards from the top of your stock into your waiting room (CR 8.4.3). */
  | { readonly pay: 'stock'; readonly count: number }
  /** Put this many cards from your hand into your waiting room. */
  | { readonly pay: 'discard'; readonly count: number; readonly filter?: CardFilter }
  /** Rest this card (it must be a standing character on the stage). */
  | { readonly pay: 'rest' }
  /** Put this card into your waiting room. */
  | { readonly pay: 'selfToWaiting' };

/**
 * What a step acts on: the card with the ability, the cards an earlier
 * `choose` step picked, or every character matching a selector when the step
 * runs.
 */
export type Target = 'this' | { readonly ref: string } | { readonly all: Selector };

/** For `lookTop`: which looked-at cards to take, and where they go. */
export interface LookTake {
  readonly count: number;
  readonly upTo?: true;
  readonly filter?: CardFilter;
  readonly to: (typeof LOOK_DESTINATIONS)[number];
}

export type Step =
  /** Pick characters on a stage; later steps refer to them as `{ ref: as }`. */
  | { readonly do: 'choose'; readonly as: string; readonly count: number; readonly upTo?: true; readonly what: Selector }
  | { readonly do: 'draw'; readonly count: number; readonly upTo?: true; readonly player?: 'opponent' }
  /** Put cards from hand into the waiting room. */
  | { readonly do: 'discard'; readonly count: number; readonly upTo?: true; readonly filter?: CardFilter; readonly player?: 'opponent' }
  /** Put the top card of your deck into your stock, this many times. */
  | { readonly do: 'stockFromDeck'; readonly count: number }
  /** Put the top card of your clock into your waiting room, this many times. */
  | { readonly do: 'heal'; readonly count: number }
  | { readonly do: 'power'; readonly amount: number; readonly target: Target; readonly duration?: Duration }
  | { readonly do: 'soul'; readonly amount: number; readonly target: Target; readonly duration?: Duration }
  /** Deal damage to your opponent; the card with the ability is its source (CR 4.11.1.2). */
  | { readonly do: 'damageOpp'; readonly amount: number }
  /** Return cards from your waiting room to your hand. */
  | { readonly do: 'salvage'; readonly count: number; readonly upTo?: true; readonly filter?: CardFilter }
  /** Look at the top cards of your deck, optionally take some, then put the rest somewhere. */
  | { readonly do: 'lookTop'; readonly count: number; readonly upTo?: true; readonly take?: LookTake; readonly rest: (typeof LOOK_REST)[number] }
  | { readonly do: 'sendToWaiting'; readonly target: Target }
  | { readonly do: 'returnToHand'; readonly target: Target }
  /** "You may (steps). If you do, (then). If you do not, (else)." (CR 8.6.4) */
  | { readonly do: 'may'; readonly steps: readonly Step[]; readonly then?: readonly Step[]; readonly else?: readonly Step[] }
  | { readonly do: 'if'; readonly when: readonly Condition[]; readonly then: readonly Step[]; readonly else?: readonly Step[] };

/** A standing change from a continuous ability. */
export interface Modifier {
  readonly stat: 'power' | 'soul';
  readonly amount: number;
  readonly target: 'this' | Selector;
}

export type Trigger =
  /** This card is played and put on the stage (or, for a climax, into the climax area). */
  | { readonly on: 'play' }
  /** This card attacks. */
  | { readonly on: 'attack' }
  /** This card becomes reversed in battle. */
  | { readonly on: 'reversed' }
  /** A climax (optionally with this name) is played into your climax area. */
  | { readonly on: 'climaxPlayed'; readonly name?: string };

export interface ActivatedAbility {
  readonly kind: 'activated';
  readonly timing: AbilityTiming;
  readonly cost: readonly CostPart[];
  /** The ability can be used only while these hold. */
  readonly when?: readonly Condition[];
  readonly effect: readonly Step[];
}

export interface AutomaticAbility {
  readonly kind: 'automatic';
  readonly trigger: Trigger;
  /** An optional cost: "you may pay (cost). If you do, (effect)." (CR 8.1.1.2.2) */
  readonly cost?: readonly CostPart[];
  readonly effect: readonly Step[];
}

export interface ContinuousAbility {
  readonly kind: 'continuous';
  /** The modifiers apply only while these hold (CR 8.3). */
  readonly when?: readonly Condition[];
  readonly modifiers: readonly Modifier[];
}

/** CR 8.1.1: every ability is exactly one of the three kinds. */
export type Ability = ActivatedAbility | AutomaticAbility | ContinuousAbility;
