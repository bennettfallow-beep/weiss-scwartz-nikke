// Turn structure (CR 6) and the engine run loop.
//
// The engine keeps a queue of small tasks. `run` pops tasks until the game
// needs a player decision (`pending`) or ends. Interrupt rule actions are
// checked before every task, so they can cut into the middle of a multi-step
// action such as "draw two" (CR 3.2.3.2, 9.1.2.1).

import { costOf } from '../model/cards';
import { other } from '../model/types';
import type { Action, CardCatalog, CardId, GameState, PlayerId, Slot, Task, TurnPhase } from '../model/types';
import { EngineFault } from '../core/fault';
import { defOf, log, moveCard, ownersZone, stageSlot, topOf } from '../core/zones';
import { payEncore, resolveAuto } from './autos';
import {
  attackDamage,
  attackDecision,
  battle,
  declareAttack,
  encoreEnd,
  encoreLoop,
  enterStep,
  nextIcon,
  orderIcon,
  performIcon,
  sendReversed,
  triggerCheck,
  triggerToStock,
  useBackup,
} from './combat';
import { damageCheck, damageReveal, startDamage } from './damage';
import { expireTurnEffects } from './effects';
import { payStock } from './play';
import { queue } from './queue';
import { checkTiming, endGame, HAND_LIMIT, performInterrupt, resolveLevelUp, runInterrupts } from './ruleActions';

export { queue };

const MAX_STEPS = 200_000;

/** Phase scripts. Each phase lists its steps in rule order and ends by entering the next phase. */
export function enterPhase(s: GameState, phase: TurnPhase): void {
  s.phase = phase;
  s.step = null;
  log(s, { kind: 'phase', phase });
  switch (phase) {
    case 'stand': // CR 6.2
      queue(
        s,
        { t: 'trigger', condition: 'turnStart' },
        { t: 'trigger', condition: 'standPhaseStart' },
        { t: 'check' },
        { t: 'standAll' },
        { t: 'check' },
        { t: 'phase', phase: 'draw' },
      );
      return;
    case 'draw': // CR 6.3
      queue(s, { t: 'trigger', condition: 'drawPhaseStart' }, { t: 'check' }, { t: 'draw', player: s.active }, { t: 'check' }, { t: 'phase', phase: 'clock' });
      return;
    case 'clock': // CR 6.4
      queue(s, { t: 'trigger', condition: 'clockPhaseStart' }, { t: 'check' }, { t: 'clockDecision' });
      return;
    case 'main': // CR 6.5: no separate check here; the play timing brings its own
      queue(s, { t: 'trigger', condition: 'mainPhaseStart' }, { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'climax': // CR 6.6
      queue(s, { t: 'trigger', condition: 'climaxPhaseStart' }, { t: 'check' }, { t: 'playTiming', window: 'climax', checked: false });
      return;
    case 'attack': // CR 6.7, Section 7: steps run from enterStep; the Encore Step leads to the End Phase.
      s.attacks = 0;
      s.attack = null;
      queue(s, { t: 'step', step: 'declaration', first: true });
      return;
    case 'end': // CR 6.8
      s.flags.endCheckResolved = false;
      queue(
        s,
        { t: 'trigger', condition: 'turnEnd' },
        { t: 'check' },
        { t: 'handLimit' },
        { t: 'climaxCleanup' },
        { t: 'check', mark: 'endPhase' },
        { t: 'expireEffects' },
        { t: 'endOfTurn' },
      );
      return;
  }
}

/** CR 4.7.1: draw the top card of the player's own deck. Does nothing if the deck is empty (CR 1.3.2). */
export function drawOne(s: GameState, player: PlayerId): void {
  const top = topOf(s.players[player], 'deck');
  if (top !== undefined) moveCard(s, top, { player, zone: 'hand' }, 'draw');
}

/** Queues N single-card draws. Zero or negative N does nothing (CR 1.3.2.2). */
export function queueDraws(s: GameState, player: PlayerId, n: number): void {
  const count = Math.max(0, Math.floor(n));
  queue(s, ...Array.from({ length: count }, (): Task => ({ t: 'draw', player })));
}

export function execTask(s: GameState, catalog: CardCatalog, task: Task): void {
  switch (task.t) {
    case 'phase':
      enterPhase(s, task.phase);
      return;
    case 'trigger':
      // Automatic abilities waiting on these conditions are added in M3.
      log(s, { kind: 'trigger', condition: task.condition });
      return;
    case 'check':
      checkTiming(s, catalog, task);
      return;
    case 'draw':
      drawOne(s, task.player);
      return;
    case 'standAll': {
      // CR 6.2.1.2: only the turn player's characters. Already-standing ones do not "stand" again (CR 1.3.2.1).
      for (const cards of s.players[s.active].stage) {
        for (const c of cards) {
          if (c.orientation !== 'stand') {
            c.orientation = 'stand';
            log(s, { kind: 'orientation', card: c.id, orientation: 'stand' });
          }
        }
      }
      return;
    }
    case 'mulligan':
      s.pending = { kind: 'mulligan', player: task.player };
      return;
    case 'clockDecision':
      if (s.players[s.active].hand.length === 0) queue(s, { t: 'check' }, { t: 'phase', phase: 'main' });
      else s.pending = { kind: 'clock', player: s.active };
      return;
    case 'playTiming': {
      // CR 8.5.2.1: a check timing always comes right before a play timing.
      // The Counter Step's play timing belongs to the non-turn player (CR 7.4.1.2).
      const player = task.window === 'counter' ? other(s.active) : s.active;
      if (!task.checked) {
        queue(s, { t: 'check' }, { t: 'playTiming', window: task.window, checked: true });
      } else {
        s.pending = { kind: 'play', player, window: task.window };
        log(s, { kind: 'playTiming', player, window: task.window });
      }
      return;
    }
    case 'handLimit': {
      const excess = s.players[s.active].hand.length - HAND_LIMIT;
      if (excess > 0) s.pending = { kind: 'discard', player: s.active, count: excess };
      return;
    }
    case 'climaxCleanup':
      for (const c of [...s.players[s.active].climax]) moveCard(s, c.id, ownersZone(s, c.id, 'waiting'), 'climaxCleanup');
      return;
    case 'endOfTurn':
      // CR 6.8.1.5: the turn ends only if the hand is within the limit and the last check timing had nothing to do.
      if (s.players[s.active].hand.length <= HAND_LIMIT && !s.flags.endCheckResolved) queue(s, { t: 'startTurn' });
      else queue(s, { t: 'phase', phase: 'end' });
      return;
    case 'startTurn':
      s.active = s.turn === 0 ? s.starting : other(s.active);
      s.turn += 1;
      log(s, { kind: 'turnStart', player: s.active });
      queue(s, { t: 'phase', phase: 'stand' });
      return;
    case 'played':
      log(s, { kind: 'played', player: task.player, card: task.card });
      return;
    case 'resolveCard':
      resolveCard(s, catalog, task.player, task.card, task.slot);
      return;
    case 'step':
      enterStep(s, task.step, task.first === true);
      return;
    case 'attackDecision':
      attackDecision(s, catalog);
      return;
    case 'triggerCheck':
      triggerCheck(s, catalog);
      return;
    case 'nextIcon':
      nextIcon(s);
      return;
    case 'icon':
      performIcon(s, catalog, task.icon);
      return;
    case 'triggerToStock':
      triggerToStock(s);
      return;
    case 'attackDamage':
      attackDamage(s, catalog);
      return;
    case 'battle':
      battle(s, catalog);
      return;
    case 'attackEnd': // CR 7.5.1.4 / 7.6.1.5
      queue(s, { t: 'trigger', condition: 'attackEnd' }, { t: 'check' }, { t: 'endSubPhase' });
      return;
    case 'endSubPhase':
      s.attack = null;
      queue(s, { t: 'step', step: 'declaration' });
      return;
    case 'encoreLoop':
      encoreLoop(s, catalog);
      return;
    case 'encoreEnd':
      encoreEnd(s, catalog);
      return;
    case 'damage':
      startDamage(s, task.target, task.amount, task.source);
      return;
    case 'damageReveal':
      damageReveal(s);
      return;
    case 'damageCheck':
      damageCheck(s, catalog);
      return;
    case 'auto':
      resolveAuto(s, task.id);
      return;
    case 'expireEffects':
      expireTurnEffects(s);
      return;
  }
}

/** CR 8.6.2.5.1-8.6.2.5.3: put the played card where its type goes. */
function resolveCard(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId, slot: Slot | undefined): void {
  const kind = defOf(s, catalog, card).kind;
  if (kind === 'character') {
    if (slot === undefined) throw new EngineFault('a character needs a stage position');
    // A character already there is removed later by rule action (CR 9.6.2).
    moveCard(s, card, { player, zone: 'stage', slot }, 'play');
  } else if (kind === 'event') {
    moveCard(s, card, { player, zone: 'resolution' }, 'play');
    // Event effects are resolved here from M3 on.
    moveCard(s, card, ownersZone(s, card, 'waiting'), 'eventResolved');
  } else {
    moveCard(s, card, { player, zone: 'climax' }, 'play');
  }
}

/** Runs the engine until it needs a decision or the game is over. */
export function run(s: GameState, catalog: CardCatalog): void {
  for (let steps = 0; !s.result && !s.pending; steps++) {
    if (steps > MAX_STEPS) throw new EngineFault('engine did not reach a decision');
    if (runInterrupts(s, catalog)) continue;
    const task = s.tasks.shift();
    if (!task) throw new EngineFault('engine has no work and no pending decision');
    execTask(s, catalog, task);
  }
}

function swapSlots(s: GameState, player: PlayerId, a: Slot, b: Slot): void {
  const p = s.players[player];
  const cardsA = stageSlot(p, a);
  const cardsB = stageSlot(p, b);
  p.stage[a - 1] = cardsB;
  p.stage[b - 1] = cardsA;
  // Both cards move at the same time and keep their orientation and identity (CR 3.1.4, 3.6.3).
  for (const c of cardsA) log(s, { kind: 'move', card: c.id, from: { player, zone: 'stage', slot: a }, to: { player, zone: 'stage', slot: b }, reason: 'swap' });
  for (const c of cardsB) log(s, { kind: 'move', card: c.id, from: { player, zone: 'stage', slot: b }, to: { player, zone: 'stage', slot: a }, reason: 'swap' });
}

/**
 * Pays the cost now; "played" and resolution are separate tasks so that an
 * interrupt rule action that became due during payment (held back while
 * paying, CR 9.2.3 / 9.3.3) runs as soon as payment ends (CR 9.1.2.1).
 */
function playCard(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId, slot?: Slot): Task[] {
  payStock(s, player, costOf(defOf(s, catalog, card)));
  const resolve: Task = slot === undefined ? { t: 'resolveCard', player, card } : { t: 'resolveCard', player, card, slot };
  return [{ t: 'played', player, card }, resolve];
}

/** Applies an already-validated action to the working state. */
export function perform(s: GameState, catalog: CardCatalog, action: Action): void {
  const pending = s.pending;
  log(s, { kind: 'action', action });
  // Concede and reorder are allowed at any time and do not answer the pending decision.
  if (action.type === 'CONCEDE') {
    endGame(s, [{ player: action.player, reason: 'concede' }]);
    return;
  }
  if (action.type === 'REORDER') {
    s.players[action.player][action.zone] = [...action.order];
    return;
  }

  s.pending = null;
  const p = action.player;
  switch (action.type) {
    case 'MULLIGAN':
      for (const card of action.discard) moveCard(s, card, ownersZone(s, card, 'waiting'), 'mulligan');
      s.players[p].mulliganDone = true;
      queueDraws(s, p, action.discard.length);
      return;
    case 'CLOCK':
      if (action.card === null) {
        queue(s, { t: 'check' }, { t: 'phase', phase: 'main' });
      } else {
        moveCard(s, action.card, { player: p, zone: 'clock' }, 'clock');
        queue(s, { t: 'draw', player: p }, { t: 'draw', player: p }, { t: 'check' }, { t: 'phase', phase: 'main' });
      }
      return;
    case 'PLAY_CHARACTER':
      queue(s, ...playCard(s, catalog, p, action.card, action.slot), { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PLAY_EVENT':
      // CR 7.4.1.2.2: one action ends the Counter Step's play timing.
      if (pending?.kind === 'play' && pending.window === 'counter') queue(s, ...playCard(s, catalog, p, action.card), { t: 'check' }, { t: 'step', step: 'damage' });
      else queue(s, ...playCard(s, catalog, p, action.card), { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PLAY_CLIMAX':
      // CR 6.6.1.2.2: one action ends the climax play timing.
      queue(s, ...playCard(s, catalog, p, action.card), { t: 'check' }, { t: 'phase', phase: 'attack' });
      return;
    case 'SWAP':
      swapSlots(s, p, action.a, action.b);
      queue(s, { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PASS':
      if (pending?.kind === 'play') {
        if (pending.window === 'main') queue(s, { t: 'phase', phase: 'climax' });
        else if (pending.window === 'climax') queue(s, { t: 'check' }, { t: 'phase', phase: 'attack' });
        else queue(s, { t: 'check' }, { t: 'step', step: 'damage' });
      } else if (pending?.kind === 'attack') {
        // CR 7.2.1.3.2: end the Attack Phase; go straight to the Encore Step.
        queue(s, { t: 'step', step: 'encore' });
      }
      // Otherwise PASS declines an optional choice and play simply continues.
      return;
    case 'LEVEL_UP':
      if (pending?.kind !== 'levelUp') throw new EngineFault('LEVEL_UP without a level-up prompt');
      resolveLevelUp(s, p, action.card, pending.options);
      return;
    case 'CHOOSE_INTERRUPT':
      performInterrupt(s, p, action.interrupt);
      return;
    case 'DISCARD':
      for (const card of action.cards) moveCard(s, card, ownersZone(s, card, 'waiting'), 'handLimit');
      return;
    case 'ATTACK':
      declareAttack(s, catalog, action.slot, action.attack);
      return;
    case 'BACKUP':
      useBackup(s, catalog, p, action.card);
      queue(s, { t: 'check' }, { t: 'step', step: 'damage' });
      return;
    case 'ORDER_ICON':
      orderIcon(s, action.icon);
      return;
    case 'CHOOSE_CARD':
      chooseCard(s, pending, action.card);
      return;
    case 'CHOOSE_SLOT':
      if (pending?.kind !== 'chooseSlot') throw new EngineFault('CHOOSE_SLOT without a position prompt');
      // Standby: the character goes in rested; a character already there leaves by rule action (CR 4.12.2.10.1).
      moveCard(s, pending.card, { player: p, zone: 'stage', slot: action.slot }, 'icon', { orientation: 'rest' });
      return;
    case 'CHOOSE_DEST':
      if (pending?.kind !== 'chooseDest') throw new EngineFault('CHOOSE_DEST without a destination prompt');
      moveCard(s, pending.card, ownersZone(s, pending.card, action.dest), 'icon');
      return;
    case 'ACCEPT':
      if (pending?.kind === 'encore') payEncore(s, p, pending.card, pending.slot, pending.cost);
      else if (pending?.kind === 'confirm' && pending.reason === 'draw') drawOne(s, p);
      else if (pending?.kind === 'confirm') {
        // Pool, and the second half of Treasure: the deck's top card into stock.
        const top = topOf(s.players[p], 'deck');
        if (top !== undefined) moveCard(s, top, { player: p, zone: 'stock' }, 'icon');
      } else throw new EngineFault('ACCEPT without a yes/no prompt');
      return;
    case 'ORDER_AUTO':
      queue(s, { t: 'auto', id: action.auto });
      return;
  }
}

/** CHOOSE_CARD answers a `choose` prompt; what happens depends on why it was asked. */
function chooseCard(s: GameState, pending: GameState['pending'], card: CardId): void {
  if (pending?.kind !== 'choose') throw new EngineFault('CHOOSE_CARD without a choose prompt');
  const p = pending.player;
  switch (pending.reason) {
    case 'return': // CR 4.12.2.3
    case 'comeback': // CR 4.12.2.5
    case 'gate': // CR 4.12.2.9
      moveCard(s, card, ownersZone(s, card, 'hand'), 'icon');
      return;
    case 'standby': // CR 4.12.2.10: now pick the position
      s.pending = { kind: 'chooseSlot', player: p, card, options: [1, 2, 3, 4, 5] };
      return;
    case 'choice': // CR 4.12.2.11: now pick hand or stock
      s.pending = { kind: 'chooseDest', player: p, card, options: ['hand', 'stock'] };
      return;
    case 'encoreStep': // CR 7.7.1.2-7.7.1.3
      sendReversed(s, card);
      return;
  }
}
