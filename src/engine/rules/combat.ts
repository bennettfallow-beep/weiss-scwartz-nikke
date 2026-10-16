// The Attack Phase (CR 7): attack declaration, trigger, counter, damage,
// battle and encore steps, and the trigger icon actions (CR 4.12).

import { CENTER_STAGE, facing } from '../model/stage';
import { other, SLOTS } from '../model/types';
import type { AttackStep, AttackType, CardCatalog, CardId, GameState, Orientation, PlayerId, Slot, Task, TriggerIcon } from '../model/types';
import { EngineFault } from '../core/fault';
import { defOf, locate, log, moveCard, ownersZone, stageSlot, topOf } from '../core/zones';
import { addTurnEffect, currentLevel, currentPower, currentSoul, playerLevel, refOf, sameObject, stillAt } from './effects';
import { payStock } from './play';
import { queue } from './queue';
import { fireAttack, fireReversed } from './triggers';

/** Step scripts, in rule order. Each ends by queuing what comes next. */
export function enterStep(s: GameState, step: AttackStep, first: boolean): void {
  s.step = step;
  log(s, { kind: 'step', step });
  const a = s.attack;
  switch (step) {
    case 'declaration': {
      // CR 7.2.1.1-7.2.1.2: "beginning of attack phase" only before the turn's first declaration step.
      const start: Task[] = first ? [{ t: 'trigger', condition: 'attackPhaseStart' }, { t: 'check' }] : [];
      queue(s, ...start, { t: 'trigger', condition: 'attackDeclarationStart' }, { t: 'check' }, { t: 'attackDecision' });
      return;
    }
    case 'trigger': // CR 7.3
      if (!a) throw new EngineFault('trigger step without an attack');
      queue(
        s,
        { t: 'trigger', condition: 'triggerStepStart' },
        { t: 'check' },
        { t: 'triggerCheck' },
        { t: 'check' },
        { t: 'step', step: a.type === 'frontal' ? 'counter' : 'damage' },
      );
      return;
    case 'counter': // CR 7.4: the non-turn player's play timing brings its own check timing
      queue(s, { t: 'trigger', condition: 'counterStepStart' }, { t: 'playTiming', window: 'counter', checked: false });
      return;
    case 'damage': // CR 7.5
      if (!a) throw new EngineFault('damage step without an attack');
      queue(
        s,
        { t: 'trigger', condition: 'damageStepStart' },
        { t: 'check' },
        { t: 'attackDamage' },
        { t: 'check' },
        a.type === 'frontal' ? { t: 'step', step: 'battle' } : { t: 'attackEnd' },
      );
      return;
    case 'battle': // CR 7.6
      queue(s, { t: 'trigger', condition: 'battleStepStart' }, { t: 'check' }, { t: 'battle' }, { t: 'check' }, { t: 'attackEnd' });
      return;
    case 'encore': // CR 7.7
      queue(s, { t: 'trigger', condition: 'encoreStepStart' }, { t: 'check' }, { t: 'encoreLoop' });
      return;
  }
}

// --- Attack Declaration Step (CR 7.2) --------------------------------------------------

export interface AttackOption {
  slot: Slot;
  attack: AttackType;
}

/**
 * Attacks the turn player may declare now. Any Stand State character on their
 * center stage can attack (CR 7.2.1.3.1.1). With no character facing it the
 * attack is Direct; otherwise the player picks Frontal or Side (CR 7.2.1.4).
 * The starting player's first turn allows one attack only (CR 7.2.1.3.1.2).
 */
export function attackOptions(s: GameState, catalog: CardCatalog): AttackOption[] {
  if (s.turn === 1 && s.active === s.starting && s.attacks >= 1) return [];
  const me = s.players[s.active];
  const out: AttackOption[] = [];
  for (const slot of CENTER_STAGE) {
    const cards = stageSlot(me, slot);
    const c = cards[0];
    if (cards.length !== 1 || !c || c.orientation !== 'stand' || defOf(s, catalog, c.id).kind !== 'character') continue;
    if (facingCharacter(s, catalog, other(s.active), slot) === null) out.push({ slot, attack: 'direct' });
    else out.push({ slot, attack: 'frontal' }, { slot, attack: 'side' });
  }
  return out;
}

/** The opposing character facing a center position (CR 3.6.6), if any. */
function facingCharacter(s: GameState, catalog: CardCatalog, opponent: PlayerId, slot: Slot): CardId | null {
  const f = facing(slot);
  if (f === null) return null;
  const c = stageSlot(s.players[opponent], f).find((x) => defOf(s, catalog, x.id).kind === 'character');
  return c?.id ?? null;
}

/** Offers the attack choice, or ends the Attack Phase when no attack can be declared (CR 7.2.1.3.1.3). */
export function attackDecision(s: GameState, catalog: CardCatalog): void {
  if (attackOptions(s, catalog).length === 0) queue(s, { t: 'step', step: 'encore' });
  else s.pending = { kind: 'attack', player: s.active };
}

/** CR 7.2.1.4-7.2.1.6: fix the attack type and its soul change, set the attack states, rest the attacker. */
export function declareAttack(s: GameState, catalog: CardCatalog, slot: Slot, type: AttackType): void {
  const player = s.active;
  const attacker = stageSlot(s.players[player], slot)[0];
  if (!attacker) throw new EngineFault('no attacker at that position');
  const facingSlot = facing(slot);
  const facingCard = facingCharacter(s, catalog, other(player), slot);
  s.attacks += 1;
  s.attack = {
    type,
    attacker: refOf(s, attacker.id),
    slot,
    facing: facingCard === null ? null : refOf(s, facingCard),
    facingSlot: facingCard === null ? null : facingSlot,
  };
  log(s, { kind: 'attack', player, card: attacker.id, slot, attack: type, facing: facingCard });
  if (type === 'direct') addTurnEffect(s, attacker.id, 'soul', 1);
  if (type === 'side' && facingCard !== null) {
    const x = currentLevel(s, catalog, facingCard);
    if (x > 0) addTurnEffect(s, attacker.id, 'soul', -x);
  }
  setOrientation(s, attacker.id, 'rest');
  fireAttack(s, catalog, attacker.id);
  queue(s, { t: 'check' }, { t: 'step', step: 'trigger' });
}

/** Changes a stage character's orientation. A card already in that orientation does not change (CR 1.3.2.1). */
export function setOrientation(s: GameState, card: CardId, orientation: Orientation): void {
  const loc = locate(s, card);
  if (loc?.zone !== 'stage' || loc.slot === undefined) throw new EngineFault(`${card} is not on the stage`);
  const c = stageSlot(s.players[loc.player], loc.slot)[loc.index];
  if (!c || c.orientation === orientation) return;
  c.orientation = orientation;
  log(s, { kind: 'orientation', card, orientation });
}

/** The attacking character, while it is still the same object in the same position (CR 7.2.1.5). */
export function attackerNow(s: GameState): CardId | null {
  const a = s.attack;
  return a && stillAt(s, a.attacker, s.active, a.slot) ? a.attacker.card : null;
}

/** The defending character of a Frontal Attack, while it stays where it was (CR 7.2.1.5.1). */
export function defenderNow(s: GameState): CardId | null {
  const a = s.attack;
  if (!a || a.type !== 'frontal' || !a.facing || a.facingSlot === null) return null;
  return stillAt(s, a.facing, other(s.active), a.facingSlot) ? a.facing.card : null;
}

// --- Trigger Step (CR 7.3, 4.12) --------------------------------------------------------

/** CR 7.3.1.2: reveal the deck's top card into the resolution zone; its icons are fixed now (CR 7.3.1.2.2). */
export function triggerCheck(s: GameState, catalog: CardCatalog): void {
  const player = s.active;
  const top = topOf(s.players[player], 'deck');
  // Deck and waiting room both empty: there is no card to reveal, so nothing happens (CR 1.3.2); the next check timing ends the game.
  if (top === undefined) return;
  moveCard(s, top, { player, zone: 'resolution' }, 'triggerCheck');
  const icons = [...(defOf(s, catalog, top).triggers ?? [])];
  s.triggerCheck = { player, card: refOf(s, top), remaining: icons };
  log(s, { kind: 'triggerCheck', player, card: top, icons });
  queue(s, { t: 'nextIcon' });
}

/** Carries out the next icon; with different icons left, the player picks the order (CR 7.3.1.2.1). */
export function nextIcon(s: GameState): void {
  const tc = s.triggerCheck;
  if (!tc) throw new EngineFault('no trigger check in progress');
  const distinct = [...new Set(tc.remaining)];
  if (distinct.length > 1) {
    s.pending = { kind: 'iconOrder', player: tc.player, icons: distinct };
    return;
  }
  const icon = tc.remaining.shift();
  queue(s, ...(icon === undefined ? [{ t: 'triggerToStock' } as const] : [{ t: 'icon', icon } as const, { t: 'nextIcon' } as const]));
}

/** ORDER_ICON: carry out this icon next. */
export function orderIcon(s: GameState, icon: TriggerIcon): void {
  const tc = s.triggerCheck;
  const i = tc ? tc.remaining.indexOf(icon) : -1;
  if (!tc || i < 0) throw new EngineFault(`icon ${icon} is not waiting`);
  tc.remaining.splice(i, 1);
  queue(s, { t: 'icon', icon }, { t: 'nextIcon' });
}

function inResolution(s: GameState, card: CardId): boolean {
  return locate(s, card)?.zone === 'resolution';
}

/** One trigger icon action (CR 4.12.2). The turn player performs it (CR 4.12.1). */
export function performIcon(s: GameState, catalog: CardCatalog, icon: TriggerIcon): void {
  const tc = s.triggerCheck;
  if (!tc) throw new EngineFault('no trigger check in progress');
  const p = tc.player;
  const me = s.players[p];
  log(s, { kind: 'icon', player: p, icon });
  const characters = (ids: readonly CardId[]) => ids.filter((id) => defOf(s, catalog, id).kind === 'character');
  const choose = (reason: 'return' | 'comeback' | 'gate' | 'standby' | 'choice', options: CardId[]) => {
    if (options.length > 0) s.pending = { kind: 'choose', player: p, reason, options, optional: true };
  };
  switch (icon) {
    case 'soul': {
      // Mandatory +1 soul for the attacking character until end of turn.
      const attacker = attackerNow(s);
      if (attacker !== null) addTurnEffect(s, attacker, 'soul', 1);
      return;
    }
    case 'return':
      choose('return', characters(s.players[other(p)].stage.flatMap((cards) => cards.map((c) => c.id))));
      return;
    case 'pool':
    case 'draw':
      if (me.deck.length > 0) s.pending = { kind: 'confirm', player: p, reason: icon };
      return;
    case 'comeback':
      choose('comeback', characters(me.waiting));
      return;
    case 'shot': {
      const attacker = attackerNow(s);
      if (attacker !== null) s.watchers.push({ player: p, source: refOf(s, attacker) });
      return;
    }
    case 'treasure':
      // The return to hand is mandatory; it moves the card, so it will not go to stock (CR 4.12.2.8.1).
      if (sameObject(s, tc.card) && inResolution(s, tc.card.card)) moveCard(s, tc.card.card, ownersZone(s, tc.card.card, 'hand'), 'icon');
      if (me.deck.length > 0) s.pending = { kind: 'confirm', player: p, reason: 'treasure' };
      return;
    case 'gate':
      choose('gate', me.waiting.filter((id) => defOf(s, catalog, id).kind === 'climax'));
      return;
    case 'standby': {
      const max = playerLevel(s, p) + 1;
      choose('standby', characters(me.waiting).filter((id) => currentLevel(s, catalog, id) <= max));
      return;
    }
    case 'choice':
      choose('choice', characters(me.waiting).filter((id) => (defOf(s, catalog, id).triggers ?? []).includes('soul')));
      return;
  }
}

/** CR 7.3.1.2.3: the checked card goes face down into stock, if it is still in the resolution zone. */
export function triggerToStock(s: GameState): void {
  const tc = s.triggerCheck;
  s.triggerCheck = null;
  if (tc && sameObject(s, tc.card) && inResolution(s, tc.card.card)) moveCard(s, tc.card.card, ownersZone(s, tc.card.card, 'stock'), 'triggerToStock');
}

// --- Counter Step: Backup (CR 10.5) -------------------------------------------------------

/** Whether `player` may use this card's Backup now (CR 10.5.1-10.5.2). */
export function canBackup(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId): boolean {
  const b = defOf(s, catalog, card).backup;
  return (
    b !== undefined &&
    s.step === 'counter' &&
    player !== s.active &&
    s.players[player].hand.includes(card) &&
    playerLevel(s, player) >= b.level &&
    s.players[player].stock.length >= b.stock &&
    defenderNow(s) !== null
  );
}

/** Pays the Backup cost (stock, then this card to the waiting room) and gives the defender +X power until end of turn. */
export function useBackup(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId): void {
  const b = defOf(s, catalog, card).backup;
  if (!b) throw new EngineFault(`${card} has no Backup`);
  payStock(s, player, b.stock);
  moveCard(s, card, ownersZone(s, card, 'waiting'), 'cost');
  const target = defenderNow(s);
  log(s, { kind: 'backup', player, card, target, power: b.power });
  if (target !== null) addTurnEffect(s, target, 'power', b.power);
}

// --- Damage and Battle Steps (CR 7.5, 7.6) ---------------------------------------------------

/** CR 7.5.1.2: an attacking character that still exists deals damage equal to its soul. */
export function attackDamage(s: GameState, catalog: CardCatalog): void {
  const a = s.attack;
  const attacker = attackerNow(s);
  if (!a || attacker === null) return;
  queue(s, { t: 'damage', target: other(s.active), amount: currentSoul(s, catalog, attacker), source: a.attacker });
}

/** CR 7.6.1.2-7.6.1.3: compare power; the lower is reversed, both on a tie. */
export function battle(s: GameState, catalog: CardCatalog): void {
  const attacker = attackerNow(s);
  const defender = defenderNow(s);
  if (attacker === null || defender === null) return;
  const pa = currentPower(s, catalog, attacker);
  const pd = currentPower(s, catalog, defender);
  const reversed = pa < pd ? [attacker] : pd < pa ? [defender] : [attacker, defender];
  log(s, { kind: 'battle', attacker, defender, reversed });
  for (const c of reversed) setOrientation(s, c, 'reverse');
  for (const c of reversed) fireReversed(s, catalog, c);
}

// --- Encore Step (CR 7.7) -------------------------------------------------------------------

function reversedOn(s: GameState, catalog: CardCatalog, player: PlayerId): CardId[] {
  return s.players[player].stage.flatMap((cards) => cards.filter((c) => c.orientation === 'reverse' && defOf(s, catalog, c.id).kind === 'character').map((c) => c.id));
}

/**
 * CR 7.7.1.2-7.7.1.3: the turn player sends their reversed characters to the
 * waiting room one at a time, with a check timing after each; then the
 * non-turn player, going back to the turn player after each.
 */
export function encoreLoop(s: GameState, catalog: CardCatalog): void {
  for (const player of [s.active, other(s.active)] as const) {
    const reversed = reversedOn(s, catalog, player);
    const only = reversed[0];
    if (only === undefined) continue;
    if (reversed.length === 1) sendReversed(s, only);
    else s.pending = { kind: 'choose', player, reason: 'encoreStep', options: reversed, optional: false };
    return;
  }
  queue(s, { t: 'check' }, { t: 'encoreEnd' });
}

export function sendReversed(s: GameState, card: CardId): void {
  moveCard(s, card, ownersZone(s, card, 'waiting'), 'encoreStep');
  queue(s, { t: 'check' }, { t: 'encoreLoop' });
}

/** CR 7.7.1.4: back to the loop if anything is reversed again, else on to the End Phase. */
export function encoreEnd(s: GameState, catalog: CardCatalog): void {
  const any = reversedOn(s, catalog, 0).length + reversedOn(s, catalog, 1).length > 0;
  queue(s, any ? { t: 'encoreLoop' } : { t: 'phase', phase: 'end' });
}

/** Stage positions a Standby character may go to: any of the player's five (CR 4.12.2.10). */
export const STANDBY_SLOTS: readonly Slot[] = SLOTS;
