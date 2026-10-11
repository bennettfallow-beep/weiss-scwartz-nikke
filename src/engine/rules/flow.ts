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
import { payStock } from './play';
import { checkTiming, endGame, HAND_LIMIT, performInterrupt, resolveLevelUp, runInterrupts } from './ruleActions';

const MAX_STEPS = 200_000;

/** Puts tasks at the front of the queue, in the given order. */
export function queue(s: GameState, ...tasks: Task[]): void {
  s.tasks.unshift(...tasks);
}

/** Phase scripts. Each phase lists its steps in rule order and ends by entering the next phase. */
export function enterPhase(s: GameState, phase: TurnPhase): void {
  s.phase = phase;
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
    case 'attack': // CR 6.7 / Section 7 arrives in M2; until then the phase passes straight through.
      queue(s, { t: 'phase', phase: 'end' });
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
    case 'playTiming':
      // CR 8.5.2.1: a check timing always comes right before a play timing.
      if (!task.checked) {
        queue(s, { t: 'check' }, { t: 'playTiming', window: task.window, checked: true });
      } else {
        s.pending = { kind: 'play', player: s.active, window: task.window };
        log(s, { kind: 'playTiming', player: s.active, window: task.window });
      }
      return;
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
  }
}

/** Runs the engine until it needs a decision or the game is over. */
export function run(s: GameState, catalog: CardCatalog): void {
  for (let steps = 0; !s.result && !s.pending; steps++) {
    if (steps > MAX_STEPS) throw new EngineFault('engine did not reach a decision');
    if (runInterrupts(s)) continue;
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

function playCard(s: GameState, catalog: CardCatalog, player: PlayerId, card: CardId): void {
  payStock(s, player, costOf(defOf(s, catalog, card)));
  log(s, { kind: 'played', player, card });
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
      playCard(s, catalog, p, action.card);
      // CR 8.6.2.5.1: a character already there is removed later by rule action (CR 9.6.2).
      moveCard(s, action.card, { player: p, zone: 'stage', slot: action.slot }, 'play');
      queue(s, { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PLAY_EVENT':
      playCard(s, catalog, p, action.card);
      moveCard(s, action.card, { player: p, zone: 'resolution' }, 'play');
      // Event effects are resolved here from M3 on.
      moveCard(s, action.card, ownersZone(s, action.card, 'waiting'), 'eventResolved');
      queue(s, { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PLAY_CLIMAX':
      playCard(s, catalog, p, action.card);
      moveCard(s, action.card, { player: p, zone: 'climax' }, 'play');
      // CR 6.6.1.2.2: one action ends the climax play timing.
      queue(s, { t: 'check' }, { t: 'phase', phase: 'attack' });
      return;
    case 'SWAP':
      swapSlots(s, p, action.a, action.b);
      queue(s, { t: 'playTiming', window: 'main', checked: false });
      return;
    case 'PASS':
      if (pending?.kind === 'play' && pending.window === 'climax') queue(s, { t: 'check' }, { t: 'phase', phase: 'attack' });
      else queue(s, { t: 'phase', phase: 'climax' });
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
  }
}
