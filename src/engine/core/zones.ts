// Zone bookkeeping. moveCard is the only function that moves a card between
// zones, which is what makes card conservation checkable.

import type {
  CardCatalog,
  CardDef,
  CardId,
  EventBody,
  GameState,
  MoveReason,
  Orientation,
  PlayerId,
  PlayerState,
  Slot,
  ZoneName,
  ZoneRef,
} from '../model/types';
import { lookupDef } from '../model/cards';
import { deepClone, deepFreeze } from './clone';
import { EngineFault } from './fault';

type ListZone = Exclude<ZoneName, 'stage' | 'climax'>;
const LIST_ZONES: readonly ListZone[] = ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'resolution'];

export function log(s: GameState, body: EventBody): void {
  s.seq += 1;
  // Events are frozen: states share them after copying, so nobody may change one.
  s.log.push(deepFreeze(deepClone({ seq: s.seq, turn: s.turn, phase: s.phase, ...body })));
}

export function defOf(s: GameState, catalog: CardCatalog, id: CardId): CardDef {
  const inst = s.cards[id];
  if (!inst) throw new EngineFault(`unknown card ${id}`);
  const def = lookupDef(catalog, inst.def);
  if (!def) throw new EngineFault(`card ${id} has unknown definition ${inst.def}`);
  return def;
}

export function list(p: PlayerState, zone: ListZone): CardId[] {
  return p[zone];
}

export interface Location {
  player: PlayerId;
  zone: ZoneName;
  slot?: Slot;
  index: number;
}

/** Finds where a card currently is. */
export function locate(s: GameState, id: CardId): Location | null {
  for (const player of [0, 1] as const) {
    const p = s.players[player];
    for (const zone of LIST_ZONES) {
      const index = p[zone].indexOf(id);
      if (index >= 0) return { player, zone, index };
    }
    for (let i = 0; i < p.stage.length; i++) {
      const index = (p.stage[i] ?? []).findIndex((c) => c.id === id);
      if (index >= 0) return { player, zone: 'stage', slot: (i + 1) as Slot, index };
    }
    const index = p.climax.findIndex((c) => c.id === id);
    if (index >= 0) return { player, zone: 'climax', index };
  }
  return null;
}

/** CR 4.3.2: the master of a card in a zone is the player the zone belongs to. */
export function masterOf(s: GameState, id: CardId): PlayerId {
  const loc = locate(s, id);
  if (!loc) throw new EngineFault(`card ${id} is in no zone`);
  return loc.player;
}

/** CR 3.1.6: a destination that names no player means the card owner's zone. */
export function ownersZone(s: GameState, id: CardId, zone: ZoneName, slot?: Slot): ZoneRef {
  const inst = s.cards[id];
  if (!inst) throw new EngineFault(`unknown card ${id}`);
  return slot === undefined ? { player: inst.owner, zone } : { player: inst.owner, zone, slot };
}

export function stageSlot(p: PlayerState, slot: Slot) {
  const cards = p.stage[slot - 1];
  if (!cards) throw new EngineFault(`bad slot ${slot}`);
  return cards;
}

export interface MoveOptions {
  /** Insert at the bottom instead of the top (list zones only). */
  bottom?: boolean;
  /** Orientation when entering the stage from another zone. Default stand (CR 3.6.3). */
  orientation?: Orientation;
}

/**
 * Moves one card. Removes it from wherever it is, inserts it at the
 * destination, bumps its object identity unless this is a stage-to-stage move
 * (CR 3.1.4), stamps stage/climax placements, and logs the move.
 */
export function moveCard(s: GameState, id: CardId, to: ZoneRef, reason: MoveReason, opts: MoveOptions = {}): void {
  const from = locate(s, id);
  if (!from) throw new EngineFault(`moveCard: card ${id} is in no zone`);
  const src = s.players[from.player];
  let carriedOrientation: Orientation | undefined;
  if (from.zone === 'stage') {
    const cards = stageSlot(src, from.slot as Slot);
    carriedOrientation = cards[from.index]?.orientation;
    cards.splice(from.index, 1);
  } else if (from.zone === 'climax') {
    src.climax.splice(from.index, 1);
  } else {
    list(src, from.zone).splice(from.index, 1);
  }

  const dst = s.players[to.player];
  if (to.zone === 'stage') {
    if (to.slot === undefined) throw new EngineFault('moveCard: stage destination needs a slot');
    const orientation = from.zone === 'stage' ? (carriedOrientation ?? 'stand') : (opts.orientation ?? 'stand');
    s.seq += 1;
    stageSlot(dst, to.slot).push({ id, orientation, placedAt: s.seq });
  } else if (to.zone === 'climax') {
    s.seq += 1;
    dst.climax.push({ id, placedAt: s.seq });
  } else if (opts.bottom) {
    list(dst, to.zone).unshift(id);
  } else {
    list(dst, to.zone).push(id);
  }

  const inst = s.cards[id];
  if (!inst) throw new EngineFault(`unknown card ${id}`);
  if (!(from.zone === 'stage' && to.zone === 'stage')) inst.epoch += 1;

  const fromRef: ZoneRef = from.slot === undefined ? { player: from.player, zone: from.zone } : { player: from.player, zone: from.zone, slot: from.slot };
  log(s, { kind: 'move', card: id, from: fromRef, to, reason });
}

/** Top card of a list zone (last element), or undefined when empty. */
export function topOf(p: PlayerState, zone: ListZone): CardId | undefined {
  const cards = list(p, zone);
  return cards[cards.length - 1];
}

/** All card ids in a player's zones, in a fixed zone order (for invariants and hashing). */
export function allCardIds(p: PlayerState): CardId[] {
  return [
    ...LIST_ZONES.flatMap((z) => p[z]),
    ...p.stage.flatMap((cards) => cards.map((c) => c.id)),
    ...p.climax.map((c) => c.id),
  ];
}

/** Public zones (CR 3.1.3); deck, hand and stock are hidden. */
export function isPublicZone(zone: ZoneName): boolean {
  return zone !== 'deck' && zone !== 'hand' && zone !== 'stock';
}
