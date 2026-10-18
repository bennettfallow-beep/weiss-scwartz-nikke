// What cards, effects and costs are worth to a player, in rough units of "one
// card in hand". Plain rules of thumb from public card data only; docs/AI.md
// explains them in words.

import type { CardCatalog, CardDef, CostPart, Side, Step, Target } from '../engine';

/** One stock is worth about half a card: it pays for plays, Backup and Encore. */
export const STOCK = 0.5;
/** One point of damage to the opponent. */
export const DAMAGE = 1.2;

export function defOf(catalog: CardCatalog, def: string): CardDef | undefined {
  return Object.hasOwn(catalog, def) ? catalog[def] : undefined;
}

/** A character in play: power, soul and level. */
export function fighter(power: number, soul: number, level: number): number {
  return power / 1000 + 1.5 * soul + 0.5 * level;
}

/** A character card by its printed numbers, plus a little for each ability. */
export function characterValue(def: CardDef): number {
  return fighter(def.power ?? 0, def.soul ?? 0, def.level ?? 0) + 0.5 * (def.abilities?.length ?? 0);
}

/** Who a step's target belongs to: the card itself and earlier picks are judged by their selector. */
function sideOf(target: Target, refs: ReadonlyMap<string, Side>): { side: Side; all: boolean } {
  if (target === 'this') return { side: 'you', all: false };
  if ('ref' in target) return { side: refs.get(target.ref) ?? 'you', all: false };
  return { side: target.all.side, all: true };
}

/** What a list of effect steps is worth to the ability's master. */
export function stepsValue(steps: readonly Step[] | undefined, refs: Map<string, Side> = new Map()): number {
  let total = 0;
  for (const step of steps ?? []) total += stepValue(step, refs);
  return total;
}

function stepValue(step: Step, refs: Map<string, Side>): number {
  switch (step.do) {
    case 'choose':
      refs.set(step.as, step.what.side);
      return 0;
    case 'draw':
      return (step.player === 'opponent' ? -1 : 1) * step.count;
    case 'discard':
      return (step.player === 'opponent' ? 0.9 : -0.9) * step.count;
    case 'stockFromDeck':
      return STOCK * step.count;
    case 'heal':
      return 1.2 * step.count;
    case 'power':
    case 'soul': {
      const { side, all } = sideOf(step.target, refs);
      const size = step.do === 'power' ? (0.8 * step.amount) / 1000 : 1.5 * step.amount;
      return (side === 'you' ? 1 : -1) * size * (all ? 2 : 1);
    }
    case 'damageOpp':
      return DAMAGE * step.amount;
    case 'salvage':
      return 0.9 * step.count;
    case 'lookTop': {
      const take = step.take;
      if (!take) return 0.3;
      return 0.3 + take.count * (take.to === 'hand' ? 0.8 : take.to === 'stock' ? STOCK : 0.1);
    }
    case 'sendToWaiting': {
      const { side } = sideOf(step.target, refs);
      return side === 'you' ? -3 : 3;
    }
    case 'returnToHand': {
      const { side } = sideOf(step.target, refs);
      return side === 'you' ? -1 : 2;
    }
    case 'may':
      return Math.max(stepsValue(step.steps, refs) + stepsValue(step.then, refs), stepsValue(step.else, refs));
    case 'if':
      return (stepsValue(step.then, refs) + stepsValue(step.else, refs)) / 2;
  }
}

/** What the steps do to the cards picked under `as`, from their controller's point of view. */
export function effectOnPick(steps: readonly Step[] | undefined, as: string): number {
  let total = 0;
  for (const step of steps ?? []) {
    switch (step.do) {
      case 'power':
      case 'soul':
        if (typeof step.target === 'object' && 'ref' in step.target && step.target.ref === as) total += step.do === 'power' ? (0.8 * step.amount) / 1000 : 1.5 * step.amount;
        break;
      case 'sendToWaiting':
        if (typeof step.target === 'object' && 'ref' in step.target && step.target.ref === as) total -= 3;
        break;
      case 'returnToHand':
        if (typeof step.target === 'object' && 'ref' in step.target && step.target.ref === as) total -= 2;
        break;
      case 'may':
        total += effectOnPick(step.steps, as) + effectOnPick(step.then, as);
        break;
      case 'if':
        total += (effectOnPick(step.then, as) + effectOnPick(step.else, as)) / 2;
        break;
      case 'choose':
      case 'draw':
      case 'discard':
      case 'stockFromDeck':
      case 'heal':
      case 'damageOpp':
      case 'salvage':
      case 'lookTop':
        break;
    }
  }
  return total;
}

/** What paying a cost loses. `source` is the worth of the card with the ability. */
export function costValue(cost: readonly CostPart[] | undefined, source: number): number {
  let total = 0;
  for (const part of cost ?? []) {
    switch (part.pay) {
      case 'stock':
        total -= STOCK * part.count;
        break;
      case 'discard':
        total -= 0.9 * part.count;
        break;
      case 'rest':
        total -= 0.5;
        break;
      case 'selfToWaiting':
        total -= source;
        break;
    }
  }
  return total;
}

/** What playing a character's "when played" abilities is worth. */
export function onPlayValue(def: CardDef): number {
  let total = 0;
  for (const a of def.abilities ?? []) {
    if (a.kind !== 'automatic' || a.trigger.on !== 'play') continue;
    total += Math.max(0, stepsValue(a.effect) + costValue(a.cost, 0));
  }
  return total;
}

/**
 * How useful a card in hand is, judged against the other cards kept (`others`)
 * and the player's level. Low values are the first to clock or discard.
 */
export function keepValue(def: CardDef | undefined, others: readonly (CardDef | undefined)[], level: number): number {
  if (!def) return 0;
  switch (def.kind) {
    case 'climax':
      // One climax is worth holding for the climax phase; more mostly wait.
      return others.some((o) => o?.kind === 'climax') ? 0.8 : 2.5;
    case 'event':
      return 1.5 + Math.max(0, stepsValue(def.effect)) * 0.5 + (def.counter ? 1 : 0);
    case 'character': {
      let v = characterValue(def) + (def.backup ? 1 : 0) + (def.counter ? 0.5 : 0);
      const lvl = def.level ?? 0;
      if (lvl > level + 1) v *= 0.5;
      if (lvl === 0 && level >= 2) v *= 0.7;
      return v;
    }
  }
}
