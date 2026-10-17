// Automatic abilities in standby (CR 8.7): the default Encore every character
// has (CR 10.2.3), the Shot icon's damage-cancel watch (CR 4.12.2.7), and the
// cards' own automatic abilities (rules/triggers.ts puts those in standby).

import { other } from '../model/types';
import type { CardCatalog, CardId, GameState, PlayerId, Slot, StandbyAuto, Task } from '../model/types';
import type { AutomaticAbility } from '../model/abilities';
import { deepClone } from '../core/clone';
import { EngineFault } from '../core/fault';
import { defOf, locate, log, moveCard } from '../core/zones';
import { nextId } from './damage';
import { sameObject } from './effects';
import { canPayCost } from './costs';
import { automaticOps, openFrame } from './frame';
import { payStock } from './play';
import { queue } from './queue';

/** CR 10.2.3: Encore [3]: pay 3 stock. */
export const ENCORE_COST = 3;

/**
 * Turns zone changes since the last look into standby abilities (CR 8.7.2).
 * Encore triggers whenever a character goes from the stage to the waiting
 * room, for whoever was its master on the stage (CR 10.2.1, 8.7.4.1).
 */
export function collectTriggers(s: GameState, catalog: CardCatalog): void {
  for (const m of s.moved) {
    if (m.from.zone !== 'stage' || m.to.zone !== 'waiting' || m.from.slot === undefined) continue;
    if (defOf(s, catalog, m.card).kind !== 'character') continue;
    s.standby.push({ id: nextId(s), ability: 'encore', player: m.from.player, card: { card: m.card, epoch: m.epoch }, slot: m.from.slot, cost: ENCORE_COST });
  }
  s.moved = [];
}

/**
 * Whether a standby ability can be played right now (CR 8.7.3.2). An Encore
 * needs its card still in the waiting room and enough stock; a card ability
 * with an optional cost needs that cost to be payable. A card ability whose
 * card has moved can still be played; what it can no longer do just fails
 * (CR 8.7.7).
 */
function playable(s: GameState, catalog: CardCatalog, a: StandbyAuto): boolean {
  switch (a.ability) {
    case 'shot':
      return true;
    case 'encore':
      return inWaitingRoom(s, a) && s.players[a.player].stock.length >= a.cost;
    case 'card': {
      // Judged on what both players can see, so whether it is offered says nothing about the hand.
      const ability = cardAbility(s, catalog, a);
      return ability.cost === undefined || canPayCost(s, catalog, a.player, a.source, ability.cost, true);
    }
  }
}

function cardAbility(s: GameState, catalog: CardCatalog, a: Extract<StandbyAuto, { ability: 'card' }>): AutomaticAbility {
  const ability = defOf(s, catalog, a.source.card).abilities?.[a.index];
  if (ability?.kind !== 'automatic') throw new EngineFault(`standby ${a.id} is not an automatic ability`);
  return ability;
}

/**
 * CR 8.5.1.2-8.5.1.3: the turn player plays one of their standby abilities
 * (choosing which if several can be played), then the rule actions are checked
 * again; only then the non-turn player. Returns true if one was started.
 * `again` is the check pass to come back to afterwards.
 *
 * Only playable abilities are offered. One that cannot be played now stays in
 * standby, since another ability may make it playable (an Encore waiting for
 * stock). Once none of a player's abilities can be played, the rest are used
 * up: choosing one would only use it up unplayed (CR 8.7.3.2), and every cost
 * here is optional, so no outcome is lost by skipping that choice.
 */
export function playStandby(s: GameState, catalog: CardCatalog, again: Task): boolean {
  for (const player of [s.active, other(s.active)] as const) {
    const mine = s.standby.filter((a) => a.player === player);
    if (mine.length === 0) continue;
    const ready = mine.filter((a) => playable(s, catalog, a));
    const only = ready[0];
    if (!only) {
      for (const a of mine) if (a.ability === 'card') log(s, { kind: 'abilityLapsed', player, card: a.source.card, index: a.index });
      s.standby = s.standby.filter((a) => a.player !== player);
      continue;
    }
    queue(s, again);
    if (ready.length === 1) queue(s, { t: 'auto', id: only.id });
    else s.pending = { kind: 'autoOrder', player, options: deepClone(ready) };
    return true;
  }
  return false;
}

/** Plays one standby ability; its standby instance is used up either way (CR 8.7.3, 8.7.3.2). */
export function resolveAuto(s: GameState, catalog: CardCatalog, id: number): void {
  const i = s.standby.findIndex((a) => a.id === id);
  const a: StandbyAuto | undefined = s.standby[i];
  if (!a) throw new EngineFault(`no standby ability ${id}`);
  s.standby.splice(i, 1);
  switch (a.ability) {
    case 'shot':
      // "Deal one damage to your opponent."
      log(s, { kind: 'auto', player: a.player, ability: 'shot', card: a.source.card });
      queue(s, { t: 'damage', target: other(a.player), amount: 1, source: null });
      return;
    case 'encore':
      if (playable(s, catalog, a)) s.pending = { kind: 'encore', player: a.player, card: a.card.card, slot: a.slot, cost: a.cost };
      return;
    case 'card': {
      if (!playable(s, catalog, a)) {
        log(s, { kind: 'abilityLapsed', player: a.player, card: a.source.card, index: a.index });
        return;
      }
      const inst = s.cards[a.source.card];
      const ability = cardAbility(s, catalog, a);
      openFrame(s, { kind: 'automatic', master: a.player, source: a.source, def: inst?.def ?? '', index: a.index, ops: automaticOps(ability), ...(ability.cost ? { cost: ability.cost } : {}) });
      queue(s, { t: 'frame' });
      return;
    }
  }
}

function inWaitingRoom(s: GameState, a: Extract<StandbyAuto, { ability: 'encore' }>): boolean {
  return sameObject(s, a.card) && locate(s, a.card.card)?.zone === 'waiting';
}

/** CR 10.2.2: pay the cost, then put the card back on its old position in the Rest State. */
export function payEncore(s: GameState, player: PlayerId, card: CardId, slot: Slot, cost: number): void {
  payStock(s, player, cost);
  log(s, { kind: 'auto', player, ability: 'encore', card });
  if (locate(s, card)?.zone === 'waiting') moveCard(s, card, { player, zone: 'stage', slot }, 'encore', { orientation: 'rest' });
}
