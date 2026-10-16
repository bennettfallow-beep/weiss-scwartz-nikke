// Which cards an ability's text refers to: filters, stage selectors, counts and
// conditions, plus the power and soul that continuous abilities add.

import { levelOf } from '../model/cards';
import { other, SLOTS } from '../model/types';
import type { CardCatalog, CardId, CardRef, GameState, PlayerId } from '../model/types';
import type { CardFilter, Condition, CountSpec, Selector, Side } from '../model/abilities';
import { defOf, locate, stageSlot } from '../core/zones';
import { attackerNow, defenderNow } from './combat';

/** Who the text's "you" and "opponent" are: relative to the ability's master (CR 4.3.3). */
export interface TextContext {
  master: PlayerId;
  /** The card with the ability; "other" and "this" refer to it. */
  source: CardRef;
}

export function sidePlayer(master: PlayerId, side: Side | undefined): PlayerId {
  return side === 'opponent' ? other(master) : master;
}

/** Card information tests. Missing information never equals a value (CR 2.19.2). */
export function matchesFilter(s: GameState, catalog: CardCatalog, card: CardId, f: CardFilter): boolean {
  const def = defOf(s, catalog, card);
  if (f.kind !== undefined && def.kind !== f.kind) return false;
  if (f.name !== undefined && def.name !== f.name) return false; // CR 2.1.2: exactly that name
  if (f.trait !== undefined && !(def.traits ?? []).includes(f.trait)) return false;
  if (f.color !== undefined && def.color !== f.color) return false;
  if (f.level !== undefined) {
    const level = levelOf(def);
    if (f.level.min !== undefined && level < f.level.min) return false;
    if (f.level.max !== undefined && level > f.level.max) return false;
  }
  return true;
}

/** A player's characters on the stage, position 1 to 5. */
export function stageCharacters(s: GameState, catalog: CardCatalog, player: PlayerId): CardId[] {
  return SLOTS.flatMap((slot) => stageSlot(s.players[player], slot).map((c) => c.id)).filter((id) => defOf(s, catalog, id).kind === 'character');
}

/** Characters on a stage matching a selector right now (CR 2.3.2.1.2). */
export function selectStage(s: GameState, catalog: CardCatalog, ctx: TextContext, sel: Selector): CardId[] {
  const player = sidePlayer(ctx.master, sel.side);
  return stageCharacters(s, catalog, player).filter((id) => {
    if (sel.other === true && id === ctx.source.card) return false;
    if (sel.role === 'attacker' && attackerNow(s) !== id) return false;
    if (sel.role === 'defender' && defenderNow(s) !== id) return false;
    return matchesFilter(s, catalog, id, sel);
  });
}

/**
 * Cards counted by a count condition. With no zone named, climaxes are counted
 * in the climax area (CR 2.3.2.3.2) and everything else on the stage.
 */
export function countCards(s: GameState, catalog: CardCatalog, ctx: TextContext, spec: CountSpec): number {
  const p = s.players[sidePlayer(ctx.master, spec.side)];
  const zone = spec.zone ?? (spec.kind === 'climax' ? 'climax' : 'stage');
  const ids: CardId[] =
    zone === 'stage' ? SLOTS.flatMap((slot) => stageSlot(p, slot).map((c) => c.id)) : zone === 'climax' ? p.climax.map((c) => c.id) : [...p[zone]];
  // On the stage, "character" is implied unless the spec names a kind.
  const filter: CardFilter = zone === 'stage' && spec.kind === undefined ? { ...spec, kind: 'character' } : spec;
  return ids.filter((id) => matchesFilter(s, catalog, id, filter)).length;
}

function within(n: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || n >= min) && (max === undefined || n <= max);
}

/** True if every condition holds (an empty or missing list holds). */
export function holds(s: GameState, catalog: CardCatalog, ctx: TextContext, conditions: readonly Condition[] | undefined): boolean {
  return (conditions ?? []).every((c) => {
    switch (c.if) {
      case 'level':
        return within(s.players[sidePlayer(ctx.master, c.side)].level.length, c.min, c.max);
      case 'climax': // CR 2.3.2.3.2: a climax in the climax area
        return s.players[sidePlayer(ctx.master, c.side)].climax.some((x) => {
          const def = defOf(s, catalog, x.id);
          return def.kind === 'climax' && (c.name === undefined || def.name === c.name);
        });
      case 'count':
        return within(countCards(s, catalog, ctx, c.what), c.min, c.max);
      case 'turn':
        return s.active === sidePlayer(ctx.master, c.side);
    }
  });
}

/**
 * CR 2.12: a character's abilities work only on the stage and a climax's only
 * in the climax area. Returns the master (the zone's player) if the card is
 * there, else null.
 */
export function workingMaster(s: GameState, catalog: CardCatalog, card: CardId): PlayerId | null {
  const loc = locate(s, card);
  if (!loc) return null;
  const kind = defOf(s, catalog, card).kind;
  if (kind === 'character' && loc.zone === 'stage') return loc.player;
  if (kind === 'climax' && loc.zone === 'climax') return loc.player;
  return null;
}

/**
 * Power or soul that continuous abilities give a character right now. Sources
 * are the characters on both stages and the cards in both climax areas whose
 * conditions hold. Computed on demand, so a card that enters the stage is
 * affected at once (CR 8.9.3).
 */
export function continuousBonus(s: GameState, catalog: CardCatalog, card: CardId, stat: 'power' | 'soul'): number {
  const at = locate(s, card);
  if (at?.zone !== 'stage' || defOf(s, catalog, card).kind !== 'character') return 0;
  let total = 0;
  for (const player of [0, 1] as const) {
    const p = s.players[player];
    const sources = [...SLOTS.flatMap((slot) => stageSlot(p, slot).map((c) => c.id)), ...p.climax.map((c) => c.id)];
    for (const source of sources) {
      const abilities = defOf(s, catalog, source).abilities;
      if (!abilities || workingMaster(s, catalog, source) !== player) continue;
      const ctx: TextContext = { master: player, source: { card: source, epoch: s.cards[source]?.epoch ?? -1 } };
      for (const ability of abilities) {
        if (ability.kind !== 'continuous' || !holds(s, catalog, ctx, ability.when)) continue;
        for (const m of ability.modifiers) {
          if (m.stat !== stat) continue;
          const applies = m.target === 'this' ? card === source : selectStage(s, catalog, ctx, m.target).includes(card);
          if (applies) total += m.amount;
        }
      }
    }
  }
  return total;
}
