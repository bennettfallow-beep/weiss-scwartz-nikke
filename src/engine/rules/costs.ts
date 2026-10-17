// Ability costs (CR 8.4): checked in full before anything is paid, then paid in
// the order written inside one engine step, so no refresh or level up can cut
// into the payment (CR 8.4.2.1).

import type { CardCatalog, CardId, CardRef, GameState, PlayerId } from '../model/types';
import type { CardFilter, CostPart } from '../model/abilities';
import { EngineFault } from '../core/fault';
import { locate, moveCard, ownersZone } from '../core/zones';
import { setOrientation } from './combat';
import { sameObject } from './effects';
import { payStock } from './play';
import { matchesFilter, workingMaster } from './select';

/** The discard part of a cost, if any (the validator allows at most one). */
export function discardPart(parts: readonly CostPart[] | undefined): { count: number; filter?: CardFilter } | null {
  const part = (parts ?? []).find((p) => p.pay === 'discard');
  return part?.pay === 'discard' ? part : null;
}

/** Hand cards that may pay a discard cost. */
export function discardOptions(s: GameState, catalog: CardCatalog, master: PlayerId, filter: CardFilter | undefined): CardId[] {
  return s.players[master].hand.filter((id) => filter === undefined || matchesFilter(s, catalog, id, filter));
}

function sourceReady(s: GameState, catalog: CardCatalog, master: PlayerId, source: CardRef): boolean {
  return sameObject(s, source) && workingMaster(s, catalog, source.card) === master;
}

/**
 * CR 8.4.2.2 / 8.6.2.3.2: the whole cost must be payable, or none of it is
 * paid. Parts are checked in the order they will be paid, so a part that uses
 * this card fails once an earlier part has rested it or sent it away.
 * `publicOnly` checks only what the opponent can also see: a discard needs
 * enough cards in hand, whatever they are. Deciding whether to offer an
 * ability on hidden information would tell the opponent about the hand.
 */
export function canPayCost(s: GameState, catalog: CardCatalog, master: PlayerId, source: CardRef, parts: readonly CostPart[] | undefined, publicOnly = false): boolean {
  let stock = 0;
  let rested = false;
  let gone = false;
  for (const part of parts ?? []) {
    switch (part.pay) {
      case 'stock':
        stock += part.count;
        break;
      case 'discard': {
        const available = publicOnly ? s.players[master].hand.length : discardOptions(s, catalog, master, part.filter).length;
        if (available < part.count) return false;
        break;
      }
      case 'rest': {
        if (gone || rested || !sourceReady(s, catalog, master, source)) return false;
        const loc = locate(s, source.card);
        const card = loc?.zone === 'stage' && loc.slot !== undefined ? s.players[loc.player].stage[loc.slot - 1]?.[loc.index] : undefined;
        if (card?.orientation !== 'stand') return false;
        rested = true;
        break;
      }
      case 'selfToWaiting':
        if (gone || !sourceReady(s, catalog, master, source)) return false;
        gone = true;
        break;
    }
  }
  return stock <= s.players[master].stock.length;
}

/**
 * Pays a cost in the order written (CR 8.4.2.1). `costCards` are the hand
 * cards already chosen for the discard part. Stock is taken from the top
 * (CR 3.10.2, 8.4.3).
 */
export function payCost(s: GameState, catalog: CardCatalog, master: PlayerId, source: CardRef, parts: readonly CostPart[] | undefined, costCards: readonly CardId[]): void {
  if (!canPayCost(s, catalog, master, source, parts)) throw new EngineFault('cost became unpayable');
  for (const part of parts ?? []) {
    switch (part.pay) {
      case 'stock':
        payStock(s, master, part.count);
        break;
      case 'discard':
        if (costCards.length !== part.count || !costCards.every((c) => s.players[master].hand.includes(c))) throw new EngineFault('discard cost cards are not in hand');
        for (const card of costCards) moveCard(s, card, ownersZone(s, card, 'waiting'), 'cost');
        break;
      case 'rest':
        setOrientation(s, source.card, 'rest');
        break;
      case 'selfToWaiting':
        moveCard(s, source.card, ownersZone(s, source.card, 'waiting'), 'cost');
        break;
    }
  }
}
