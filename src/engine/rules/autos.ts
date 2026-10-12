// Automatic abilities in standby (CR 8.7) for the two rule-level abilities
// combat needs: the default Encore every character has (CR 10.2.3) and the
// Shot icon's damage-cancel watch (CR 4.12.2.7). Card abilities join in M3.

import { other } from '../model/types';
import type { CardCatalog, CardId, GameState, PlayerId, Slot, StandbyAuto, Task } from '../model/types';
import { deepClone } from '../core/clone';
import { EngineFault } from '../core/fault';
import { defOf, locate, log, moveCard } from '../core/zones';
import { nextId } from './damage';
import { sameObject } from './effects';
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
 * Whether a standby ability can be played now. An Encore whose card already
 * left the waiting room can only fail (CR 8.7.7), and one whose cost cannot be
 * paid cannot be played (CR 8.6.2.3.2, 8.7.3.2). Nothing inside an M2 check
 * timing adds stock, so an unpayable Encore stays unpayable; M3 abilities that
 * can add stock must revisit this (ABL-11, ABL-12).
 */
function playable(s: GameState, a: StandbyAuto): boolean {
  if (a.ability === 'shot') return true;
  return inWaitingRoom(s, a) && s.players[a.player].stock.length >= a.cost;
}

/**
 * CR 8.5.1.2-8.5.1.3: the turn player plays one of their standby abilities
 * (choosing which if there are several), then the rule actions are checked
 * again; only then the non-turn player. Abilities that cannot be played are
 * used up without a prompt (CR 8.7.3.2). Returns true if one was started.
 * `again` is the check pass to come back to afterwards.
 */
export function playStandby(s: GameState, again: Task): boolean {
  for (const player of [s.active, other(s.active)] as const) {
    s.standby = s.standby.filter((a) => a.player !== player || playable(s, a));
    const mine = s.standby.filter((a) => a.player === player);
    const only = mine[0];
    if (!only) continue;
    queue(s, again);
    if (mine.length === 1) queue(s, { t: 'auto', id: only.id });
    else s.pending = { kind: 'autoOrder', player, options: deepClone(mine) };
    return true;
  }
  return false;
}

/** Plays one standby ability; its standby instance is used up either way (CR 8.7.3, 8.7.3.2). */
export function resolveAuto(s: GameState, id: number): void {
  const i = s.standby.findIndex((a) => a.id === id);
  const a: StandbyAuto | undefined = s.standby[i];
  if (!a) throw new EngineFault(`no standby ability ${id}`);
  s.standby.splice(i, 1);
  if (a.ability === 'shot') {
    // "Deal one damage to your opponent."
    log(s, { kind: 'auto', player: a.player, ability: 'shot', card: a.source.card });
    queue(s, { t: 'damage', target: other(a.player), amount: 1, source: null });
    return;
  }
  // Encore: see `playable` for when it is skipped.
  if (!playable(s, a)) return;
  s.pending = { kind: 'encore', player: a.player, card: a.card.card, slot: a.slot, cost: a.cost };
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
