// Card objects, current power and soul, and "until end of turn" effects.

import { levelOf, powerOf, soulOf } from '../model/cards';
import type { CardCatalog, CardId, CardRef, GameState, PlayerId, Slot, TurnEffect } from '../model/types';
import { defOf, locate, log } from '../core/zones';

/** The card's current object (CR 3.1.4). */
export function refOf(s: GameState, card: CardId): CardRef {
  return { card, epoch: s.cards[card]?.epoch ?? -1 };
}

/** True while the card is still the same object it was when `ref` was taken. */
export function sameObject(s: GameState, ref: CardRef): boolean {
  return s.cards[ref.card]?.epoch === ref.epoch;
}

/**
 * True while the card object is still on `player`'s stage at `slot`. Each stage
 * position is its own zone (CR 3.6.1), so a card that moved to another position
 * no longer counts, and neither does one whose master changed.
 */
export function stillAt(s: GameState, ref: CardRef, player: PlayerId, slot: Slot): boolean {
  if (!sameObject(s, ref)) return false;
  const loc = locate(s, ref.card);
  return loc !== null && loc.zone === 'stage' && loc.player === player && loc.slot === slot;
}

function bonus(s: GameState, card: CardId, stat: TurnEffect['stat']): number {
  const epoch = s.cards[card]?.epoch;
  let total = 0;
  for (const e of s.effects) if (e.card.card === card && e.card.epoch === epoch && e.stat === stat) total += e.amount;
  return total;
}

/** Printed power plus effects on this card object (CR 2.9, 8.9). */
export function currentPower(s: GameState, catalog: CardCatalog, card: CardId): number {
  return powerOf(defOf(s, catalog, card)) + bonus(s, card, 'power');
}

/** Printed soul plus effects on this card object (CR 2.10, 8.9). */
export function currentSoul(s: GameState, catalog: CardCatalog, card: CardId): number {
  return soulOf(defOf(s, catalog, card)) + bonus(s, card, 'soul');
}

export function currentLevel(s: GameState, catalog: CardCatalog, card: CardId): number {
  return levelOf(defOf(s, catalog, card));
}

/** A player's level is the number of cards in their level zone (CR 3.8). */
export function playerLevel(s: GameState, player: PlayerId): number {
  return s.players[player].level.length;
}

/**
 * Gives the card's current object a change until end of turn. A change of 0
 * does nothing. It stops applying if the card changes zones (CR 8.9.2).
 */
export function addTurnEffect(s: GameState, card: CardId, stat: TurnEffect['stat'], amount: number): void {
  if (amount === 0) return;
  s.effects.push({ card: refOf(s, card), stat, amount });
  log(s, { kind: 'modifier', card, stat, amount });
}

/** CR 6.8.1.4: "until end of turn" and "during this turn" effects end. */
export function expireTurnEffects(s: GameState): void {
  if (s.effects.length === 0 && s.watchers.length === 0) return;
  s.effects = [];
  s.watchers = [];
  log(s, { kind: 'effectsExpired' });
}
