// Damage process (CR 4.10) and Shot's watch on damage from a source (CR 4.12.2.7).

import type { CardCatalog, CardRef, GameState, PlayerId } from '../model/types';
import { EngineFault } from '../core/fault';
import { defOf, locate, log, moveCard, ownersZone, topOf } from '../core/zones';
import { queue } from './queue';

/** Fresh id for a standby ability. */
export function nextId(s: GameState): number {
  s.seq += 1;
  return s.seq;
}

/**
 * Starts "deal N damage" (CR 4.10.1). There is no such thing as 0 or negative
 * damage (CR 7.5.1.2.1), so N <= 0 does nothing.
 */
export function startDamage(s: GameState, target: PlayerId, amount: number, source: CardRef | null): void {
  if (amount <= 0) return;
  if (s.damage) throw new EngineFault('a damage process is already under way');
  s.damage = { target, amount, source, cards: [] };
  log(s, { kind: 'damage', target, amount, source: source?.card ?? null });
  queue(s, { t: 'damageReveal' });
}

/**
 * CR 4.10.1.1: the damaged player puts their deck's top card face up into
 * their resolution zone. A refresh can run before the card is checked
 * (interrupt rule action), which is why reveal and check are separate tasks.
 */
export function damageReveal(s: GameState): void {
  const d = s.damage;
  if (!d) throw new EngineFault('damageReveal without a damage process');
  const top = topOf(s.players[d.target], 'deck');
  // Unreachable in M2: an empty deck is refreshed, or is an immediate loss (CR 9.2.2.1), before this task runs.
  if (top === undefined) throw new EngineFault('damage process with an empty deck');
  moveCard(s, top, { player: d.target, zone: 'resolution' }, 'damage');
  d.cards.push(top);
  queue(s, { t: 'damageCheck' });
}

/** CR 4.10.1.2-4.10.1.3: a climax cancels the damage; otherwise stop at N cards or reveal the next. */
export function damageCheck(s: GameState, catalog: CardCatalog): void {
  const d = s.damage;
  if (!d) throw new EngineFault('damageCheck without a damage process');
  const last = d.cards[d.cards.length - 1];
  if (last !== undefined && defOf(s, catalog, last).kind === 'climax') finishDamage(s, true);
  else if (d.cards.length >= d.amount) finishDamage(s, false);
  else queue(s, { t: 'damageReveal' });
}

function finishDamage(s: GameState, canceled: boolean): void {
  const d = s.damage;
  if (!d) throw new EngineFault('no damage process to finish');
  // Only cards still in the resolution zone move on, in the order they entered it (CR 3.13.1.3.1).
  const cards = d.cards.filter((c) => locate(s, c)?.zone === 'resolution');
  for (const c of cards) moveCard(s, c, ownersZone(s, c, canceled ? 'waiting' : 'clock'), canceled ? 'damageCancel' : 'damageToClock');
  s.damage = null;
  const source = d.source?.card ?? null;
  log(s, canceled ? { kind: 'damageCanceled', target: d.target, source, cards } : { kind: 'damageTaken', target: d.target, source, cards });
  settleShots(s, d.source, canceled);
}

/**
 * Shot watches only the next damage its character deals (CR 4.12.2.7.1): any
 * damage from that character uses the watch up, and a canceled one triggers it.
 */
function settleShots(s: GameState, source: CardRef | null, canceled: boolean): void {
  if (!source) return;
  const hit = s.watchers.filter((w) => w.source.card === source.card && w.source.epoch === source.epoch);
  if (hit.length === 0) return;
  s.watchers = s.watchers.filter((w) => !hit.includes(w));
  if (canceled) for (const w of hit) s.standby.push({ id: nextId(s), ability: 'shot', player: w.player, source: w.source });
}

/**
 * CR 9.2.2.1: a player whose deck and waiting room are both empty in the middle
 * of a damage process, with no climax in their resolution zone, loses at once.
 */
export function damageDeckOut(s: GameState, catalog: CardCatalog): PlayerId | null {
  const d = s.damage;
  if (!d) return null;
  const p = s.players[d.target];
  if (p.deck.length > 0 || p.waiting.length > 0) return null;
  if (p.resolution.some((c) => defOf(s, catalog, c).kind === 'climax')) return null;
  return d.target;
}
