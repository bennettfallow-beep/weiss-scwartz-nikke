// Resolving abilities and event effects (CR 8.6-8.8).
//
// The ability being resolved is a serializable frame in `s.resolving`. A
// `{ t: 'frame' }` task runs one op of it and queues itself again, so a game
// can stop at any decision inside an ability and resume from a JSON copy.
// Every card move an effect makes is its own task, so refresh and level up
// (interrupt rule actions) still run between them (CR 3.2.3.2, 9.1.2.1).
// Answers to prompts only record the choice and queue moves; they never move
// cards themselves.

import { other } from '../model/types';
import type { AbilityFrame, CardCatalog, CardId, CardRef, FrameOp, GameState, MoveReason, PickPurpose, PlayerId, Task } from '../model/types';
import type { Ability, CostPart, Step, Target } from '../model/abilities';
import { deepClone } from '../core/clone';
import { EngineFault } from '../core/fault';
import { defOf, locate, log, moveCard, ownersZone, topOf } from '../core/zones';
import { canPayCost, discardOptions, discardPart, payCost } from './costs';
import { addTurnEffect, refOf, sameObject } from './effects';
import { queue } from './queue';
import { holds, matchesFilter, selectStage, workingMaster } from './select';
import type { TextContext } from './select';

const MAX_OPS = 64;

const ctxOf = (f: AbilityFrame): TextContext => ({ master: f.master, source: f.source });
/** Steps become ops as copies, so the game state never shares objects with the card catalog. */
const stepOps = (steps: readonly Step[] | undefined): FrameOp[] => (steps ?? []).map((step) => ({ k: 'step', step: deepClone(step) }));

/** Starts resolving an ability or event effect. Only one resolves at a time. */
export function openFrame(s: GameState, frame: Pick<AbilityFrame, 'kind' | 'master' | 'source' | 'def' | 'index' | 'ops'> & { cost?: readonly CostPart[] }): void {
  if (s.resolving) throw new EngineFault('an ability is already resolving');
  if (frame.ops.length > MAX_OPS) throw new EngineFault('ability has too many steps');
  const { cost, ...rest } = frame;
  s.resolving = { ...rest, cost: deepClone([...(cost ?? [])]), chosen: [], costCards: [], look: null, wait: null };
}

/** Ops for an activated ability: choose cost cards, pay, played, then the effect (CR 8.6.2). */
export function activatedOps(ability: Extract<Ability, { kind: 'activated' }>): FrameOp[] {
  return [...(discardPart(ability.cost) ? [{ k: 'pickCost' } as const] : []), { k: 'payCost' }, { k: 'played' }, ...stepOps(ability.effect)];
}

/** Ops for an automatic ability. An optional cost is offered first (CR 8.1.1.2.2). */
export function automaticOps(ability: Extract<Ability, { kind: 'automatic' }>): FrameOp[] {
  const cost: FrameOp[] = ability.cost
    ? [{ k: 'offerCost' }, ...(discardPart(ability.cost) ? [{ k: 'pickCost' } as const] : []), { k: 'payCost' }]
    : [];
  return [...cost, { k: 'played' }, ...stepOps(ability.effect)];
}

export function eventOps(effect: readonly Step[]): FrameOp[] {
  return stepOps(effect);
}

/**
 * Whether ACCEPT is a legal answer to the open yes/no prompt. Paying a cost is
 * offered only when the cost can really be paid. The prompt itself appears
 * whenever the cost could be paid as far as the opponent can tell, so its
 * appearance says nothing about the hand.
 */
export function canAccept(s: GameState, catalog: CardCatalog): boolean {
  const f = s.resolving;
  if (f?.wait?.for !== 'payCost') return true;
  return canPayCost(s, catalog, f.master, f.source, f.cost);
}

function closeFrame(s: GameState): void {
  const f = s.resolving;
  if (f?.look) log(s, { kind: 'lookEnd', player: f.look.player });
  s.resolving = null;
}

/** The `{ t: 'frame' }` task: run the next op, or close the frame when none are left. */
export function frameTask(s: GameState, catalog: CardCatalog): void {
  const f = s.resolving;
  if (!f) throw new EngineFault('frame task without an ability resolving');
  const op = f.ops.shift();
  if (!op) {
    closeFrame(s);
    return;
  }
  // Queue the next run first; whatever this op queues lands in front of it.
  queue(s, { t: 'frame' });
  runOp(s, catalog, f, op);
}

// --- Prompts ---------------------------------------------------------------------

function ask(s: GameState, f: AbilityFrame, player: PlayerId, purpose: PickPurpose, options: CardId[], min: number, max: number): void {
  s.pending = { kind: 'pick', player, purpose, card: f.source.card, options, picked: [], min, max };
}

/**
 * Opens a pick, or settles it at once when there is no real choice: nothing to
 * pick, or everything available must be taken.
 *
 * A pick among hidden cards by their information (`hiddenPool` = how many
 * hidden cards it looks through, e.g. the hand) is always asked while there
 * are any such cards, even if none qualify or all must be taken: otherwise
 * whether the prompt appears would tell the opponent what the hidden cards are.
 */
function pick(
  s: GameState,
  catalog: CardCatalog,
  f: AbilityFrame,
  wait: NonNullable<AbilityFrame['wait']>,
  player: PlayerId,
  purpose: PickPurpose,
  options: CardId[],
  min: number,
  max: number,
  hiddenPool = 0,
): void {
  f.wait = wait;
  const settled = max === 0 || (min === max && max === options.length);
  if (settled && hiddenPool === 0) finishPick(s, catalog, f, options.slice(0, max));
  else ask(s, f, player, purpose, options, min, max);
}

function optional(s: GameState, f: AbilityFrame, wait: NonNullable<AbilityFrame['wait']>, player: PlayerId): void {
  f.wait = wait;
  const purpose = wait.for === 'payCost' || wait.for === 'may' || wait.for === 'drawMore' || wait.for === 'lookMore' ? wait.for : null;
  if (!purpose) throw new EngineFault(`not a yes/no wait: ${wait.for}`);
  s.pending = { kind: 'optional', player, purpose, card: f.source.card };
}

function moveTask(card: CardId, s: GameState, to: 'hand' | 'stock' | 'waiting', reason: MoveReason): Task {
  return { t: 'fxMove', card: refOf(s, card), to, reason };
}

function finishPick(s: GameState, catalog: CardCatalog, f: AbilityFrame, picked: readonly CardId[]): void {
  const wait = f.wait;
  f.wait = null;
  if (!wait) throw new EngineFault('a pick finished with nothing waiting for it');
  switch (wait.for) {
    case 'target':
      // A name chosen again replaces the earlier pick (the validator keeps names unique per ability).
      f.chosen = [...f.chosen.filter((c) => c.as !== wait.as), { as: wait.as, cards: picked.map((c) => refOf(s, c)) }];
      if (picked.length > 0) log(s, { kind: 'chosen', player: f.master, card: f.source.card, cards: [...picked] });
      return;
    case 'costCards':
      f.costCards = [...picked];
      return;
    case 'move':
      queue(s, ...picked.map((c) => moveTask(c, s, wait.to, wait.reason)));
      return;
    case 'order': {
      const rest = lookedInDeck(s, f).filter((c) => !picked.includes(c));
      arrange(s, f, wait.where, [...picked, ...rest]);
      return;
    }
    case 'payCost':
    case 'may':
    case 'drawMore':
    case 'lookMore':
      throw new EngineFault(`a pick answered a yes/no question (${wait.for})`);
  }
}

type PickPrompt = Extract<NonNullable<GameState['pending']>, { kind: 'pick' }>;

/** CHOOSE_CARD (`card`) or PASS (null) on the `pick` prompt `prompt`, which perform() has already cleared. */
export function answerPick(s: GameState, catalog: CardCatalog, prompt: PickPrompt, card: CardId | null): void {
  const f = s.resolving;
  if (!f) throw new EngineFault('no ability is waiting for a pick');
  if (card === null) {
    finishPick(s, catalog, f, prompt.picked);
    return;
  }
  const picked = [...prompt.picked, card];
  const options = prompt.options.filter((c) => c !== card);
  if (picked.length >= prompt.max || options.length === 0) finishPick(s, catalog, f, picked);
  else s.pending = { ...prompt, picked, options };
}

/** ACCEPT or PASS on an `optional` prompt. */
export function answerOptional(s: GameState, catalog: CardCatalog, accepted: boolean): void {
  const f = s.resolving;
  const wait = f?.wait;
  if (!f || !wait) throw new EngineFault('no yes/no question to answer');
  f.wait = null;
  if (wait.for === 'payCost' || wait.for === 'may' || wait.for === 'drawMore' || wait.for === 'lookMore') {
    log(s, { kind: 'optional', player: wait.for === 'drawMore' ? wait.player : f.master, card: f.source.card, purpose: wait.for, accepted });
  }
  switch (wait.for) {
    case 'payCost':
      // Declining the cost means the ability is not played; its standby is already used up (CR 8.7.3.2.1).
      if (!accepted) f.ops = [];
      return;
    case 'may': {
      const action = wait.step.steps[0];
      // CR 8.6.4: "if you do not" also covers not being able to.
      if (accepted && action && canDo(s, catalog, f, action)) f.ops.unshift({ k: 'step', step: action, forced: true }, ...stepOps(wait.step.then));
      else f.ops.unshift(...stepOps(wait.step.else));
      return;
    }
    case 'drawMore':
      if (!accepted) return;
      if (wait.left > 1) f.ops.unshift({ k: 'drawMore', player: wait.player, left: wait.left - 1 });
      queue(s, { t: 'draw', player: wait.player });
      return;
    case 'lookMore': {
      if (!accepted) return;
      const next = nextUnlooked(s, f);
      if (next !== undefined && f.look) {
        f.look.cards.push(refOf(s, next));
        log(s, { kind: 'look', player: f.look.player, cards: [next] });
      }
      if (wait.left > 1) f.ops.unshift({ k: 'lookMore', left: wait.left - 1 });
      return;
    }
    case 'target':
    case 'costCards':
    case 'move':
    case 'order':
      throw new EngineFault(`a yes/no answer for a pick (${wait.for})`);
  }
}

// --- Ops -----------------------------------------------------------------------------

function runOp(s: GameState, catalog: CardCatalog, f: AbilityFrame, op: FrameOp): void {
  switch (op.k) {
    case 'step':
      runStep(s, catalog, f, op.step, op.forced === true);
      return;
    case 'offerCost':
      optional(s, f, { for: 'payCost' }, f.master);
      return;
    case 'pickCost': {
      const part = discardPart(f.cost);
      if (!part) return;
      const options = discardOptions(s, catalog, f.master, part.filter);
      const hidden = part.filter === undefined ? 0 : s.players[f.master].hand.length;
      pick(s, catalog, f, { for: 'costCards' }, f.master, 'costDiscard', options, part.count, part.count, hidden);
      return;
    }
    case 'payCost':
      payCost(s, catalog, f.master, f.source, f.cost, f.costCards);
      return;
    case 'played':
      log(s, { kind: 'ability', player: f.master, card: f.source.card, index: f.index, category: f.kind });
      return;
    case 'drawMore':
      if (s.players[op.player].deck.length > 0) optional(s, f, { for: 'drawMore', player: op.player, left: op.left }, op.player);
      return;
    case 'lookMore':
      if (nextUnlooked(s, f) !== undefined) optional(s, f, { for: 'lookMore', left: op.left }, f.master);
      return;
    case 'lookTake': {
      const { take } = op;
      const looked = lookedInDeck(s, f);
      const options = looked.filter((c) => take.filter === undefined || matchesFilter(s, catalog, c, take.filter));
      const max = Math.min(take.count, options.length);
      // CR 8.6.3.1.4: unrevealed cards picked by their information may be left unpicked.
      const min = take.upTo === true || take.filter !== undefined ? 0 : max;
      pick(s, catalog, f, { for: 'move', to: take.to, reason: 'effect' }, f.master, 'lookTake', options, min, max, take.filter === undefined ? 0 : looked.length);
      return;
    }
    case 'lookRest':
      lookRest(s, catalog, f, op.rest);
      return;
  }
}

/** CR 8.6.5: the master performs unless the text names the opponent. */
function performer(f: AbilityFrame, player: 'opponent' | undefined): PlayerId {
  return player === 'opponent' ? other(f.master) : f.master;
}

/** Live card objects a target refers to now. Anything that has moved is gone (CR 8.7.7). */
export function resolveTargets(s: GameState, catalog: CardCatalog, f: AbilityFrame, target: Target): CardId[] {
  const onStage = (ref: CardRef) => sameObject(s, ref) && locate(s, ref.card)?.zone === 'stage';
  if (target === 'this') return onStage(f.source) ? [f.source.card] : [];
  if ('ref' in target) return (f.chosen.find((c) => c.as === target.ref)?.cards ?? []).filter(onStage).map((r) => r.card);
  return selectStage(s, catalog, ctxOf(f), target.all);
}

/**
 * Whether a "you may" action can be done in full right now (CR 8.6.4). One
 * reading for every action: "in full" means the whole stated number of cards
 * (cards that a deck refresh would supply count as available).
 */
function canDo(s: GameState, catalog: CardCatalog, f: AbilityFrame, step: Step): boolean {
  const p = s.players[f.master];
  const deckCards = (who: PlayerId) => s.players[who].deck.length + s.players[who].waiting.length;
  switch (step.do) {
    case 'choose':
      return selectStage(s, catalog, ctxOf(f), step.what).length >= step.count;
    case 'draw':
      return deckCards(performer(f, step.player)) >= step.count;
    case 'discard':
      return s.players[performer(f, step.player)].hand.filter((c) => step.filter === undefined || matchesFilter(s, catalog, c, step.filter)).length >= step.count;
    case 'stockFromDeck':
      return deckCards(f.master) >= step.count;
    case 'lookTop':
      return p.deck.length > 0;
    case 'heal':
      return p.clock.length >= step.count;
    case 'power':
    case 'soul':
    case 'sendToWaiting':
    case 'returnToHand':
      return resolveTargets(s, catalog, f, step.target).length > 0;
    case 'damageOpp':
      return true;
    case 'salvage':
      return p.waiting.filter((c) => step.filter === undefined || matchesFilter(s, catalog, c, step.filter)).length >= step.count;
    case 'may':
    case 'if':
      return true;
  }
}

function runStep(s: GameState, catalog: CardCatalog, f: AbilityFrame, step: Step, forced: boolean): void {
  log(s, { kind: 'effect', player: f.master, card: f.source.card, op: step.do });
  const me = s.players[f.master];
  // A fixed number must be picked as far as possible (CR 8.6.3.1); "up to" allows none (CR 8.6.3.1.1).
  const bounds = (n: number, count: number, upTo: boolean, mayFail: boolean): [number, number] => {
    const max = Math.min(count, n);
    return [forced ? max : upTo || mayFail ? 0 : max, max];
  };
  switch (step.do) {
    case 'choose': {
      const options = selectStage(s, catalog, ctxOf(f), step.what);
      const [min, max] = bounds(options.length, step.count, step.upTo === true, false);
      pick(s, catalog, f, { for: 'target', as: step.as }, f.master, 'target', options, min, max);
      return;
    }
    case 'draw': {
      const who = performer(f, step.player);
      if (step.upTo === true) f.ops.unshift({ k: 'drawMore', player: who, left: step.count });
      else queue(s, ...Array.from({ length: step.count }, (): Task => ({ t: 'draw', player: who })));
      return;
    }
    case 'discard': {
      const who = performer(f, step.player);
      const options = s.players[who].hand.filter((c) => step.filter === undefined || matchesFilter(s, catalog, c, step.filter));
      // The hand is hidden from the opponent: a choice by card information may come up empty (CR 8.6.3.1.4).
      const [min, max] = bounds(options.length, step.count, step.upTo === true, step.filter !== undefined);
      pick(s, catalog, f, { for: 'move', to: 'waiting', reason: 'effect' }, who, 'discard', options, min, max, step.filter === undefined ? 0 : s.players[who].hand.length);
      return;
    }
    case 'stockFromDeck':
      queue(s, ...Array.from({ length: step.count }, (): Task => ({ t: 'fxTop', player: f.master, from: 'deck', to: 'stock' })));
      return;
    case 'heal':
      queue(s, ...Array.from({ length: step.count }, (): Task => ({ t: 'fxTop', player: f.master, from: 'clock', to: 'waiting' })));
      return;
    case 'power':
    case 'soul':
      // The affected cards are fixed now; a card that arrives later is not affected (CR 8.9.2).
      for (const card of resolveTargets(s, catalog, f, step.target)) addTurnEffect(s, card, step.do, step.amount, step.duration === 'game' ? 'game' : undefined);
      return;
    case 'damageOpp':
      // CR 4.11.1.2: the card with the ability (or the event card) is the source.
      queue(s, { t: 'damage', target: other(f.master), amount: step.amount, source: f.source });
      return;
    case 'salvage': {
      const options = me.waiting.filter((c) => step.filter === undefined || matchesFilter(s, catalog, c, step.filter));
      const [min, max] = bounds(options.length, step.count, step.upTo === true, false);
      pick(s, catalog, f, { for: 'move', to: 'hand', reason: 'effect' }, f.master, 'salvage', options, min, max);
      return;
    }
    case 'lookTop': {
      f.look = { player: f.master, cards: [] };
      const after: FrameOp[] = [...(step.take ? [{ k: 'lookTake', take: step.take } as const] : []), { k: 'lookRest', rest: step.rest }];
      if (step.upTo === true) {
        // CR 3.2.3.1: before each card the player may stop, even before the first.
        f.ops.unshift({ k: 'lookMore', left: step.count }, ...after);
      } else {
        // CR 3.2.3.3: with fewer cards than asked, look at what is there; nothing moves, so no refresh.
        const top = [...me.deck].reverse().slice(0, step.count);
        f.look.cards = top.map((c) => refOf(s, c));
        if (top.length > 0) log(s, { kind: 'look', player: f.master, cards: top });
        f.ops.unshift(...after);
      }
      return;
    }
    case 'sendToWaiting':
    case 'returnToHand':
      queue(s, ...resolveTargets(s, catalog, f, step.target).map((c) => moveTask(c, s, step.do === 'sendToWaiting' ? 'waiting' : 'hand', 'effect')));
      return;
    case 'may':
      optional(s, f, { for: 'may', step }, f.master);
      return;
    case 'if':
      // A condition that does not hold makes that part inactive: no choices are asked (CR 8.3).
      f.ops.unshift(...stepOps(holds(s, catalog, ctxOf(f), step.when) ? step.then : step.else));
      return;
  }
}

// --- Looking at the deck (CR 4.8, 3.2.3) ------------------------------------------------

/** Looked-at cards still in the deck as the same objects, top first. Moved cards stop being looked at (CR 8.6.6.1). */
export function lookedInDeck(s: GameState, f: AbilityFrame): CardId[] {
  if (!f.look) return [];
  const deck = s.players[f.look.player].deck;
  return f.look.cards.filter((r) => sameObject(s, r) && deck.includes(r.card)).map((r) => r.card);
}

/** The highest deck card not yet looked at. */
function nextUnlooked(s: GameState, f: AbilityFrame): CardId | undefined {
  if (!f.look) return undefined;
  const looked = new Set(lookedInDeck(s, f));
  return [...s.players[f.look.player].deck].reverse().find((c) => !looked.has(c));
}

function lookRest(s: GameState, catalog: CardCatalog, f: AbilityFrame, rest: 'top' | 'bottom' | 'waiting'): void {
  const cards = lookedInDeck(s, f);
  if (rest === 'waiting') {
    endLook(s, f);
    queue(s, ...cards.map((c) => moveTask(c, s, 'waiting', 'effect')));
    return;
  }
  if (cards.length >= 2) {
    // The player orders them: first pick goes highest. The last one is implied.
    pick(s, catalog, f, { for: 'order', where: rest }, f.master, rest === 'top' ? 'orderTop' : 'orderBottom', cards, cards.length - 1, cards.length - 1);
    return;
  }
  if (cards.length === 1 && rest === 'bottom') arrange(s, f, 'bottom', cards);
  else endLook(s, f);
}

/** Puts looked-at cards back on top or at the bottom; `order[0]` ends highest. Same zone, so no new objects. */
function arrange(s: GameState, f: AbilityFrame, where: 'top' | 'bottom', order: readonly CardId[]): void {
  const look = f.look;
  if (!look) throw new EngineFault('arranging without a look');
  const p = s.players[look.player];
  const rest = p.deck.filter((c) => !order.includes(c));
  const group = [...order].reverse();
  p.deck = where === 'top' ? [...rest, ...group] : [...group, ...rest];
  log(s, { kind: 'deckArranged', player: look.player, top: where === 'top' ? order.length : 0, bottom: where === 'bottom' ? order.length : 0 });
  endLook(s, f);
}

function endLook(s: GameState, f: AbilityFrame): void {
  if (!f.look) return;
  log(s, { kind: 'lookEnd', player: f.look.player });
  f.look = null;
}

// --- Effect move tasks ------------------------------------------------------------------

/** `fxMove`: moves one card to its owner's zone, if it is still the same object (CR 3.1.6, 8.7.7). */
export function fxMove(s: GameState, card: CardRef, to: 'hand' | 'stock' | 'waiting', reason: MoveReason): void {
  if (sameObject(s, card) && locate(s, card.card) !== null) moveCard(s, card.card, ownersZone(s, card.card, to), reason);
}

/** `fxTop`: the top card of a deck or clock goes to stock or the waiting room. Nothing happens if the zone is empty. */
export function fxTop(s: GameState, player: PlayerId, from: 'deck' | 'clock', to: 'stock' | 'waiting'): void {
  const top = topOf(s.players[player], from);
  if (top !== undefined) moveCard(s, top, to === 'stock' ? { player, zone: 'stock' } : ownersZone(s, top, 'waiting'), 'effect');
}

/** `eventDone`: the resolved event goes to its owner's waiting room, if it is still in the resolution zone (CR 8.6.2.5.2). */
export function eventDone(s: GameState, card: CardRef): void {
  if (sameObject(s, card) && locate(s, card.card)?.zone === 'resolution') moveCard(s, card.card, ownersZone(s, card.card, 'waiting'), 'eventResolved');
}

// --- Activated abilities (CR 8.1.1.1, 6.5.1.2.3, 7.4.1.2) ---------------------------------

export interface Activatable {
  card: CardId;
  ability: number;
}

/**
 * Activated abilities `player` may use in this play timing: from their stage
 * characters (CR 2.12), while the ability's conditions hold and its whole cost
 * can be paid (CR 8.4.2.2). The main phase allows any of them (CR 6.5.1.2.3),
 * counter-icon ones included (CR 2.8.2.1); the opponent's Counter Step allows
 * only counter-icon ones (CR 7.4.1.2.1).
 */
export function activatable(s: GameState, catalog: CardCatalog, player: PlayerId, window: 'main' | 'climax' | 'counter'): Activatable[] {
  if (window === 'climax') return [];
  const out: Activatable[] = [];
  const p = s.players[player];
  const sources = p.stage.flatMap((cards) => cards.map((c) => c.id));
  for (const card of sources) {
    const abilities = defOf(s, catalog, card).abilities;
    if (!abilities || workingMaster(s, catalog, card) !== player) continue;
    const ctx: TextContext = { master: player, source: refOf(s, card) };
    abilities.forEach((a, i) => {
      if (a.kind !== 'activated') return;
      const allowed = window === 'main' || a.timing === 'counter';
      if (allowed && holds(s, catalog, ctx, a.when) && canPayCost(s, catalog, player, ctx.source, a.cost)) {
        out.push({ card, ability: i });
      }
    });
  }
  return out;
}

/** ACTIVATE: opens the ability's frame. The caller queues the frame task and what follows. */
export function activate(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId, index: number): void {
  const def = defOf(s, catalog, card);
  const ability = def.abilities?.[index];
  if (ability?.kind !== 'activated') throw new EngineFault(`${card} has no activated ability ${index}`);
  openFrame(s, { kind: 'activated', master: player, source: refOf(s, card), def: def.id, index, ops: activatedOps(ability), cost: ability.cost });
}
