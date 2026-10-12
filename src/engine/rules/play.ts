// Requirements for playing a card from hand (CR 8.6.2) and paying its cost (CR 8.4).

import { costOf, levelOf } from '../model/cards';
import type { CardCatalog, CardDef, CardId, GameState, PlayerId, PlayWindow } from '../model/types';
import { defOf, moveCard, ownersZone, topOf } from '../core/zones';
import { EngineFault } from '../core/fault';

/**
 * Color requirement (CR 8.6.2.1.1): the card's color must match a card in the
 * player's level or clock. Level 0 characters and level 0 events are exempt;
 * climaxes are not.
 */
export function meetsColor(s: GameState, catalog: CardCatalog, player: PlayerId, def: CardDef): boolean {
  if (def.kind !== 'climax' && levelOf(def) === 0) return true;
  const p = s.players[player];
  return [...p.level, ...p.clock].some((id) => defOf(s, catalog, id).color === def.color);
}

/** Level requirement (CR 8.6.2.1.2): card level <= cards in level zone. Climaxes are exempt. */
export function meetsLevel(s: GameState, player: PlayerId, def: CardDef): boolean {
  if (def.kind === 'climax') return true;
  return levelOf(def) <= s.players[player].level.length;
}

/** CR 8.6.2.3.2: the cost must be payable in full. */
export function canAfford(s: GameState, player: PlayerId, def: CardDef): boolean {
  return costOf(def) <= s.players[player].stock.length;
}

/**
 * Which cards each play timing allows: characters and events in the main phase
 * (CR 6.5.1.2), climaxes in the climax phase (CR 6.6.1.2.1), and only
 * counter-icon events in the opponent's Counter Step (CR 7.4.1.2.1).
 */
export function allowedInWindow(def: CardDef, window: PlayWindow): boolean {
  if (window === 'main') return def.kind === 'character' || def.kind === 'event';
  if (window === 'climax') return def.kind === 'climax';
  return def.kind === 'event' && def.counter === true;
}

export function canPlayFromHand(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId, window: PlayWindow): boolean {
  if (!s.players[player].hand.includes(card)) return false;
  const def = defOf(s, catalog, card);
  return allowedInWindow(def, window) && meetsColor(s, catalog, player, def) && meetsLevel(s, player, def) && canAfford(s, player, def);
}

/**
 * Pays a stock cost: the top `amount` stock cards go to the waiting room one
 * at a time (CR 3.10.2, 8.4.3). Runs as one uninterrupted step, so refresh and
 * level up cannot happen in the middle of it (CR 8.4.2.1).
 */
export function payStock(s: GameState, player: PlayerId, amount: number): void {
  const p = s.players[player];
  if (amount > p.stock.length) throw new EngineFault('payStock: cost was not checked');
  for (let i = 0; i < amount; i++) {
    const card = topOf(p, 'stock');
    if (card === undefined) throw new EngineFault('payStock: stock ran out');
    moveCard(s, card, ownersZone(s, card, 'waiting'), 'cost');
  }
}
