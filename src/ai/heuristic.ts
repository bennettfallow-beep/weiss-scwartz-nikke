// The heuristic computer player: scores each legal action with card-game rules
// of thumb and plays the best, breaking ties with its own seeded random source.
// No search, and it sees only what its player may see (the view).

import { ENCORE_COST, facing, HAND_LIMIT, isCenter, LEVEL_UP_AT, LOSING_LEVEL, nextInt } from '../engine';
import type { Action, CardCatalog, CardDef, CardId, Color, GameView, Pending, PlayerId, PlayerView, RngState, Selector, Slot, Step, VisibleStageCard } from '../engine';
import type { Bot, Decision } from './bot';
import { characterValue, costValue, DAMAGE, defOf, effectOnPick, fighter, keepValue, onPlayValue, STOCK, stepsValue } from './value';
import type { Situation } from './value';

/** What the bot knows while choosing: its view, the catalog, and handy lookups. */
interface Ctx {
  view: GameView;
  catalog: CardCatalog;
  me: PlayerId;
  my: PlayerView;
  opp: PlayerView;
  /** Card id -> who controls it and its definition, for every card the bot can see. */
  seen: Map<CardId, { owner: PlayerId; def: CardDef | undefined }>;
}

const NEVER = -1e9;

function context(view: GameView, catalog: CardCatalog): Ctx {
  const me = view.viewer;
  const seen: Ctx['seen'] = new Map();
  for (const pv of view.players) {
    const lists = [pv.hand ?? [], pv.waiting, pv.clock, pv.level, pv.memory, pv.resolution, pv.climax, ...pv.stage];
    for (const list of lists) for (const c of list) seen.set(c.id, { owner: pv.player, def: defOf(catalog, c.def) });
  }
  for (const c of view.look?.cards ?? []) seen.set(c.id, { owner: me, def: defOf(catalog, c.def) });
  return { view, catalog, me, my: view.players[me], opp: view.players[me === 0 ? 1 : 0], seen };
}

const defIn = (ctx: Ctx, card: CardId): CardDef | undefined => ctx.seen.get(card)?.def;
const handDefs = (ctx: Ctx, except: readonly CardId[] = []): (CardDef | undefined)[] =>
  (ctx.my.hand ?? []).filter((c) => !except.includes(c.id)).map((c) => defOf(ctx.catalog, c.def));
const myLevel = (ctx: Ctx): number => ctx.my.counts.level;

/** How useful a hand card is, judged against the rest of the hand (minus `gone`). */
function handCardValue(ctx: Ctx, card: CardId, gone: readonly CardId[] = []): number {
  return keepValue(defIn(ctx, card), handDefs(ctx, [card, ...gone]), myLevel(ctx));
}

function stageCard(pv: PlayerView, slot: Slot): VisibleStageCard | undefined {
  return pv.stage[slot - 1]?.[0];
}

/** A stage card's worth now, from its current power and soul (the view shows them). */
function stageValue(ctx: Ctx, card: VisibleStageCard | undefined): number {
  if (!card) return 0;
  const def = defOf(ctx.catalog, card.def);
  return fighter(card.power ?? def?.power ?? 0, card.soul ?? def?.soul ?? 0, def?.level ?? 0);
}

function stageEntry(ctx: Ctx, card: CardId): { owner: PlayerId; slot: Slot; card: VisibleStageCard } | null {
  for (const pv of ctx.view.players) {
    for (const [i, cards] of pv.stage.entries()) {
      const found = cards.find((c) => c.id === card);
      if (found) return { owner: pv.player, slot: (i + 1) as Slot, card: found };
    }
  }
  return null;
}

/** The starting player's first turn allows one attack only (CR 7.2.1.3.1.2). */
function attacksAllowed(view: GameView): number {
  return view.turn === 1 && view.active === view.starting ? 1 : 3;
}

/** Whether a character on the stage matches the selector now, read from the bot's own side ("you" is the bot). */
function selectorMatches(ctx: Ctx, what: Selector, source: CardId | null): boolean {
  const pv = what.side === 'you' ? ctx.my : ctx.opp;
  const attack = ctx.view.attack;
  return pv.stage.flat().some((c) => {
    const d = defOf(ctx.catalog, c.def);
    if (d?.kind !== 'character') return false;
    if (what.other && c.id === source) return false;
    if (what.name !== undefined && d.name !== what.name) return false;
    if (what.trait !== undefined && !(d.traits ?? []).includes(what.trait)) return false;
    if (what.color !== undefined && d.color !== what.color) return false;
    const level = d.level ?? 0;
    if (what.level?.min !== undefined && level < what.level.min) return false;
    if (what.level?.max !== undefined && level > what.level.max) return false;
    if (what.role === 'attacker' && c.id !== attack?.attacker.card) return false;
    if (what.role === 'defender' && c.id !== attack?.facing?.card) return false;
    return true;
  });
}

/** The situation an effect of `source` would happen in right now. */
function now(ctx: Ctx, source: CardId | null): Situation {
  return { battle: ctx.view.attack !== null, matches: (what) => selectorMatches(ctx, what, source) };
}

/** How much a card on the stage would be missed: its worth, plus one for the card itself. */
function occupantLoss(ctx: Ctx, slot: Slot): number {
  const occupant = stageCard(ctx.my, slot);
  return occupant ? stageValue(ctx, occupant) + 1 : 0;
}

function standingCenter(pv: PlayerView): VisibleStageCard[] {
  return [1, 2, 3].map((s) => stageCard(pv, s as Slot)).filter((c): c is VisibleStageCard => c?.orientation === 'stand');
}

// --- Attacks ------------------------------------------------------------------------------------

function attackScore(ctx: Ctx, slot: Slot, type: 'direct' | 'frontal' | 'side'): number {
  const attacker = stageCard(ctx.my, slot);
  if (!attacker) return NEVER;
  const def = defOf(ctx.catalog, attacker.def);
  const soul = attacker.soul ?? def?.soul ?? 0;
  const power = attacker.power ?? def?.power ?? 0;
  const facingSlot = facing(slot);
  const defender = facingSlot === null ? undefined : stageCard(ctx.opp, facingSlot);
  const defenderDef = defender ? defOf(ctx.catalog, defender.def) : undefined;
  switch (type) {
    case 'direct':
      return (soul + 1) * DAMAGE + 0.1;
    case 'side':
      return Math.max(0, soul - (defenderDef?.level ?? 0)) * DAMAGE + 0.05;
    case 'frontal': {
      const defenderPower = defender?.power ?? defenderDef?.power ?? 0;
      let battle = 0;
      if (power >= defenderPower) battle += 0.8 * stageValue(ctx, defender);
      if (power <= defenderPower) battle -= 0.8 * stageValue(ctx, attacker);
      return soul * DAMAGE + battle;
    }
  }
}

// --- Main phase -----------------------------------------------------------------------------------

/** How good a stage layout is: strong standing characters in the center, the rest behind. */
function layoutScore(ctx: Ctx, stage: readonly (VisibleStageCard | undefined)[]): number {
  let total = 0;
  stage.forEach((card, i) => {
    if (!card) return;
    const v = stageValue(ctx, card);
    total += i < 3 ? (card.orientation === 'stand' ? v : 0.5 * v) : 0.3 * v;
  });
  return total;
}

function swapScore(ctx: Ctx, a: Slot, b: Slot): number {
  const stage = ctx.my.stage.map((cards) => cards[0]);
  const swapped = [...stage];
  [swapped[a - 1], swapped[b - 1]] = [stage[b - 1], stage[a - 1]];
  const gain = layoutScore(ctx, swapped) - layoutScore(ctx, stage);
  // Only a strict improvement, so swapping can never go round in circles.
  return gain > 0.05 ? gain : NEVER;
}

function playCharacterScore(ctx: Ctx, card: CardId, slot: Slot): number {
  const def = defIn(ctx, card);
  if (!def) return NEVER;
  const weight = isCenter(slot) ? 1 : 0.4;
  let score = weight * characterValue(def) + onPlayValue(def) - STOCK * (def.cost ?? 0) - 0.5 * handCardValue(ctx, card);
  const occupant = stageCard(ctx.my, slot);
  // The character already there goes to the waiting room: count it as lost.
  if (occupant) score -= weight * stageValue(ctx, occupant) + 1;
  else if (isCenter(slot)) score += 1;
  return score;
}

function eventScore(ctx: Ctx, card: CardId): number {
  const def = defIn(ctx, card);
  if (!def) return NEVER;
  return stepsValue(def.effect, now(ctx, card)) - STOCK * (def.cost ?? 0) - 0.3;
}

/** Each activated ability at most once per turn, counted from this turn's log. */
function usedThisTurn(ctx: Ctx, card: CardId, index: number): boolean {
  return ctx.view.log.some((e) => e.turn === ctx.view.turn && e.kind === 'ability' && e.category === 'activated' && e.card === card && e.index === index);
}

function activateScore(ctx: Ctx, card: CardId, index: number): number {
  const def = defIn(ctx, card);
  const ability = def?.abilities?.[index];
  if (!def || ability?.kind !== 'activated' || usedThisTurn(ctx, card, index)) return NEVER;
  const at = stageEntry(ctx, card);
  // Resting a standing center character in the main phase costs its attack.
  const restsAttacker = ability.timing === 'main' && ability.cost.some((p) => p.pay === 'rest') && at !== null && isCenter(at.slot) && at.card.orientation === 'stand';
  return stepsValue(ability.effect, now(ctx, card)) + costValue(ability.cost, at ? stageValue(ctx, at.card) : characterValue(def)) - (restsAttacker ? 2 : 0) - 0.2;
}

function climaxScore(ctx: Ctx, card: CardId): number {
  const def = defIn(ctx, card);
  if (!def) return NEVER;
  const attackers = Math.min(standingCenter(ctx.my).length, attacksAllowed(ctx.view));
  const climaxesInHand = handDefs(ctx).filter((d) => d?.kind === 'climax').length;
  if (attackers === 0 || (attackers < 2 && climaxesInHand < 2)) return NEVER;
  let bonus = 0;
  for (const a of def.abilities ?? []) {
    if (a.kind === 'continuous') for (const m of a.modifiers) bonus += (m.stat === 'soul' ? 1.5 * m.amount : (0.8 * m.amount) / 1000) * (m.target === 'this' ? 0 : attackers);
    if (a.kind === 'automatic' && a.trigger.on === 'play') bonus += Math.max(0, stepsValue(a.effect, now(ctx, card)));
  }
  // Characters on the stage that answer this climax being played.
  for (const c of ctx.my.stage.flat()) {
    for (const a of defOf(ctx.catalog, c.def)?.abilities ?? []) {
      if (a.kind === 'automatic' && a.trigger.on === 'climaxPlayed' && (a.trigger.name === undefined || a.trigger.name === def.name)) bonus += Math.max(0, stepsValue(a.effect, now(ctx, c.id)));
    }
  }
  return 1 + bonus;
}

// --- Counter step ------------------------------------------------------------------------------------

/** Power the defender needs to gain to survive the battle, or null when it is not in a battle it loses. */
function defenderShortfall(ctx: Ctx): { gap: number; saved: number; attackerValue: number } | null {
  const attack = ctx.view.attack;
  if (!attack || attack.type !== 'frontal' || attack.facing === null) return null;
  const attacker = stageEntry(ctx, attack.attacker.card);
  const defender = stageEntry(ctx, attack.facing.card);
  if (!attacker || !defender || defender.owner !== ctx.me) return null;
  const ap = attacker.card.power ?? 0;
  const dp = defender.card.power ?? 0;
  if (dp > ap) return null;
  return { gap: ap - dp, saved: stageValue(ctx, defender.card), attackerValue: stageValue(ctx, attacker.card) };
}

/** Worth of adding `power` to the defender for `price`. */
function counterScore(ctx: Ctx, power: number, price: number): number {
  const need = defenderShortfall(ctx);
  if (!need || power <= 0) return NEVER;
  if (power > need.gap) return need.saved + 0.8 * need.attackerValue - price;
  if (power === need.gap) return 0.8 * need.attackerValue - price;
  return NEVER;
}

/** Power an effect gives your own characters (the defender, in the counter step). */
function powerGain(steps: readonly Step[] | undefined): number {
  let total = 0;
  for (const s of steps ?? []) {
    if (s.do === 'power' && s.amount > 0) total += s.amount;
    if (s.do === 'may') total += powerGain(s.steps) + powerGain(s.then);
    if (s.do === 'if') total += Math.min(powerGain(s.then), powerGain(s.else));
  }
  return total;
}

// --- Picks ---------------------------------------------------------------------------------------------

function resolvingSteps(ctx: Ctx): readonly Step[] | undefined {
  const r = ctx.view.resolving;
  if (!r) return undefined;
  const def = defOf(ctx.catalog, r.def);
  if (r.index === null) return def?.effect;
  const ability = def?.abilities?.[r.index];
  return ability && ability.kind !== 'continuous' ? ability.effect : undefined;
}

function pickScore(ctx: Ctx, p: Extract<Pending, { kind: 'pick' }>, card: CardId): number {
  switch (p.purpose) {
    case 'target': {
      const goodness = p.as === undefined ? 0 : effectOnPick(resolvingSteps(ctx), p.as);
      const entry = stageEntry(ctx, card);
      const worth = entry ? stageValue(ctx, entry.card) : 1;
      const mine = (entry?.owner ?? ctx.seen.get(card)?.owner) === ctx.me;
      return (mine ? 1 : -1) * goodness * (1 + worth / 5);
    }
    case 'costDiscard':
    case 'discard':
      // Throw away the least useful cards, and the full count once committed to it.
      return 20 - handCardValue(ctx, card, p.picked);
    case 'salvage':
    case 'lookTake':
      return 1 + keepValue(defIn(ctx, card), handDefs(ctx), myLevel(ctx));
    case 'orderTop':
    case 'orderBottom':
      return 1 + keepValue(defIn(ctx, card), handDefs(ctx), myLevel(ctx));
  }
}

// --- Other prompts -------------------------------------------------------------------------------------

function mulliganScore(ctx: Ctx, discard: readonly CardId[]): number {
  const hand = ctx.my.hand ?? [];
  const levelOnes = hand.filter((c) => defIn(ctx, c.id)?.kind === 'character' && defIn(ctx, c.id)?.level === 1);
  const keptOnes = [...levelOnes].sort((a, b) => characterValue(defIn(ctx, b.id) as CardDef) - characterValue(defIn(ctx, a.id) as CardDef)).slice(0, 2);
  const wanted = hand.filter((c) => {
    const d = defIn(ctx, c.id);
    if (!d) return false;
    if (d.kind === 'climax') return true;
    if ((d.level ?? 0) >= 2) return true;
    if (d.kind === 'event') return (d.level ?? 0) >= 1;
    return d.level === 1 && !keptOnes.includes(c);
  });
  const want = new Set(wanted.map((c) => c.id));
  let mismatches = 0;
  for (const c of hand) if (want.has(c.id) !== discard.includes(c.id)) mismatches++;
  return -mismatches;
}

function clockScore(ctx: Ctx, card: CardId | null): number {
  if (card === null) return 0;
  const level = myLevel(ctx);
  const clock = ctx.my.counts.clock;
  // Never clock into a loss, and slow down as the game gets close.
  const safe = level < LOSING_LEVEL - 2 || (level === LOSING_LEVEL - 2 && clock < LEVEL_UP_AT - 3);
  return safe ? 20 - handCardValue(ctx, card) : NEVER;
}

function levelUpScore(ctx: Ctx, p: Extract<Pending, { kind: 'levelUp' }>, card: CardId): number {
  const color = defIn(ctx, card)?.color;
  if (!color) return 0;
  const leftInClock = ctx.my.clock.filter((c) => !p.options.includes(c.id));
  const have = new Set<Color | undefined>([...ctx.my.level, ...leftInClock].map((c) => defOf(ctx.catalog, c.def)?.color));
  if (have.has(color)) return 0;
  const needing = handDefs(ctx).filter((d) => d && d.color === color && d.kind !== 'climax' && (d.level ?? 0) > 0).length;
  return 1 + needing;
}

function chooseScore(ctx: Ctx, p: Extract<Pending, { kind: 'choose' }>, card: CardId): number {
  switch (p.reason) {
    case 'return':
    case 'encoreStep':
      return 1 + stageValue(ctx, stageEntry(ctx, card)?.card);
    case 'comeback':
    case 'gate':
    case 'choice':
      return 1 + keepValue(defIn(ctx, card), handDefs(ctx), myLevel(ctx));
    case 'standby': {
      const def = defIn(ctx, card);
      if (!def) return 0;
      // With every position taken, the character goes onto the weakest one, which is lost.
      const slots = [1, 2, 3, 4, 5] as const;
      const full = slots.every((s) => stageCard(ctx.my, s));
      return 1 + characterValue(def) - (full ? Math.min(...slots.map((s) => occupantLoss(ctx, s))) : 0);
    }
  }
}

function slotScore(ctx: Ctx, slot: Slot): number {
  const occupant = stageCard(ctx.my, slot);
  if (!occupant) return isCenter(slot) ? 3 : 2;
  return 1 - 0.1 * stageValue(ctx, occupant);
}

function optionalScore(ctx: Ctx, p: Extract<Pending, { kind: 'optional' }>): number {
  switch (p.purpose) {
    case 'payCost': {
      const r = ctx.view.resolving;
      const def = r ? defOf(ctx.catalog, r.def) : undefined;
      const ability = r && r.index !== null ? def?.abilities?.[r.index] : undefined;
      if (!r || !def || !ability || ability.kind !== 'automatic') return 0.5;
      // A cost that puts the card itself into the waiting room loses what that card is worth.
      const at = stageEntry(ctx, r.card);
      const source = at ? stageValue(ctx, at.card) : characterValue(def);
      return stepsValue(ability.effect, now(ctx, r.card)) + costValue(ability.cost, source);
    }
    case 'may':
    case 'lookMore':
      return 0.5;
    case 'drawMore':
      return ctx.my.counts.hand < HAND_LIMIT ? 1 : -1;
  }
}

/** Main, climax and counter windows. */
function playScore(ctx: Ctx, p: Extract<Pending, { kind: 'play' }>, a: Action): number {
  if (a.type === 'PASS') return 0;
  if (a.type === 'PLAY_CHARACTER') return playCharacterScore(ctx, a.card, a.slot);
  if (a.type === 'PLAY_CLIMAX') return climaxScore(ctx, a.card);
  if (a.type === 'SWAP') return swapScore(ctx, a.a, a.b);
  if (a.type === 'PLAY_EVENT') {
    if (p.window !== 'counter') return eventScore(ctx, a.card);
    const def = defIn(ctx, a.card);
    return counterScore(ctx, powerGain(def?.effect), STOCK * (def?.cost ?? 0) + 1);
  }
  if (a.type === 'ACTIVATE') {
    if (p.window !== 'counter') return activateScore(ctx, a.card, a.ability);
    const ability = defIn(ctx, a.card)?.abilities?.[a.ability];
    return ability?.kind === 'activated' && !usedThisTurn(ctx, a.card, a.ability) ? counterScore(ctx, powerGain(ability.effect), -costValue(ability.cost, 3)) : NEVER;
  }
  if (a.type === 'BACKUP') {
    const backup = defIn(ctx, a.card)?.backup;
    return backup ? counterScore(ctx, backup.power, STOCK * backup.stock + 0.5 * handCardValue(ctx, a.card)) : NEVER;
  }
  return NEVER;
}

/** The score of one legal action under the pending decision. Higher is better. */
function score(ctx: Ctx, p: Pending, a: Action): number {
  switch (p.kind) {
    case 'mulligan':
      return a.type === 'MULLIGAN' ? mulliganScore(ctx, a.discard) : NEVER;
    case 'clock':
      return a.type === 'CLOCK' ? clockScore(ctx, a.card) : NEVER;
    case 'levelUp':
      return a.type === 'LEVEL_UP' ? levelUpScore(ctx, p, a.card) : NEVER;
    case 'discard':
      return a.type === 'CHOOSE_CARD' ? 20 - handCardValue(ctx, a.card, p.picked) : NEVER;
    case 'attack':
      return a.type === 'ATTACK' ? attackScore(ctx, a.slot, a.attack) : 0;
    case 'play':
      return playScore(ctx, p, a);
    case 'choose':
      return a.type === 'CHOOSE_CARD' ? chooseScore(ctx, p, a.card) : 0;
    case 'chooseSlot':
      return a.type === 'CHOOSE_SLOT' ? slotScore(ctx, a.slot) : NEVER;
    case 'chooseDest':
      return a.type === 'CHOOSE_DEST' && a.dest === 'hand' ? (ctx.my.counts.hand < HAND_LIMIT - 1 ? 1 : 0) : 0.5;
    case 'confirm':
      if (a.type !== 'ACCEPT') return 0;
      return p.reason === 'draw' && ctx.my.counts.hand >= HAND_LIMIT ? -1 : 1;
    case 'encore': {
      if (a.type !== 'ACCEPT') return 0;
      const def = defIn(ctx, p.card);
      // Returning to a position that is now taken sends the character there to the waiting room.
      return (def ? characterValue(def) : 0) - STOCK * p.cost - 2 + (ctx.my.counts.stock - p.cost >= ENCORE_COST ? 0.5 : 0) - occupantLoss(ctx, p.slot);
    }
    case 'pick':
      return a.type === 'CHOOSE_CARD' ? pickScore(ctx, p, a.card) : 0;
    case 'optional':
      return a.type === 'ACCEPT' ? optionalScore(ctx, p) : 0;
    case 'interruptOrder':
    case 'iconOrder':
    case 'autoOrder':
      return 0;
  }
}

/** The best-scoring action; ties go to the bot's own seeded random source. */
export function bestAction(legal: readonly Action[], scoreOf: (a: Action) => number, rng: RngState): Decision {
  let best = -Infinity;
  let ties: Action[] = [];
  for (const a of legal) {
    const s = scoreOf(a);
    if (s > best + 1e-9) {
      best = s;
      ties = [a];
    } else if (Math.abs(s - best) <= 1e-9) ties.push(a);
  }
  if (ties.length <= 1) return { action: ties[0] ?? (legal[0] as Action), rng };
  const [i, next] = nextInt(rng, ties.length);
  return { action: ties[i] as Action, rng: next };
}

export const heuristicBot: Bot = {
  name: 'heuristic',
  choose(view, legal, catalog, rng) {
    const pending = view.pending;
    if (!pending || 'redacted' in pending) return { action: legal[0] as Action, rng };
    // Orders rarely matter: take the first option (legal actions come sorted), so these stay predictable.
    if (pending.kind === 'interruptOrder' || pending.kind === 'iconOrder' || pending.kind === 'autoOrder') return { action: legal[0] as Action, rng };
    const ctx = context(view, catalog);
    return bestAction(legal, (a) => score(ctx, pending, a), rng);
  },
};
