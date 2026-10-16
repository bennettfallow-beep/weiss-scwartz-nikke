// Rule actions (CR 9) and the check timing (CR 4.4, 8.5.1).
//
// Interrupt-type rule actions (refresh, level up) run the moment their
// condition holds; the run loop checks for them before every engine step.
// Check-type rule actions (loss, power <= 0, illegal or extra cards) run only
// inside a check timing, all at once, repeating until none are due.

import { other } from '../model/types';
import type { CardCatalog, CardId, GameState, InterruptKind, LossReason, PlayerId, Task } from '../model/types';
import { shuffle } from '../core/rng';
import { defOf, log, moveCard, ownersZone, topOf } from '../core/zones';
import { EngineFault } from '../core/fault';
import { collectTriggers, playStandby } from './autos';
import { damageDeckOut } from './damage';
import { currentPower } from './effects';

export const HAND_LIMIT = 7;
export const LEVEL_UP_AT = 7;
export const LOSING_LEVEL = 4;

// --- Game end -------------------------------------------------------------------

/**
 * Ends the game (CR 1.2). One loser means the other player wins; both losing
 * at once is a draw (CR 1.2.3).
 */
export function endGame(s: GameState, losers: readonly { player: PlayerId; reason: LossReason }[]): void {
  const [first, second] = losers;
  if (!first) throw new EngineFault('endGame without a loser');
  if (second && second.player !== first.player) {
    const r0 = losers.find((l) => l.player === 0)?.reason ?? first.reason;
    const r1 = losers.find((l) => l.player === 1)?.reason ?? second.reason;
    s.result = { kind: 'draw', reasons: [r0, r1] };
  } else {
    s.result = { kind: 'win', winner: other(first.player), loser: first.player, reason: first.reason };
  }
  s.phase = 'gameOver';
  s.pending = null;
  s.tasks = [];
  s.resolving = null;
  log(s, { kind: 'gameOver', result: s.result });
}

// --- Interrupt-type rule actions (CR 9.2, 9.3) -----------------------------------

export function dueInterrupts(s: GameState, player: PlayerId): InterruptKind[] {
  const p = s.players[player];
  const due: InterruptKind[] = [];
  // CR 9.2.2.1: with an empty waiting room there is nothing to refresh with.
  if (p.deck.length === 0 && p.waiting.length > 0) due.push('refresh');
  if (p.clock.length >= LEVEL_UP_AT) due.push('levelUp');
  return due;
}

/**
 * Runs at most one interrupt rule action, or asks which one to run first.
 * Turn player's interrupts come before the non-turn player's (CR 9.1.2.1.1.1);
 * a player with several chooses the order (CR 9.1.2.1.1.2).
 * Returns true if it did anything.
 */
export function runInterrupts(s: GameState, catalog: CardCatalog): boolean {
  // CR 9.2.2.1: out of cards in the middle of a damage process, with no climax revealed: the refresh becomes a loss.
  const outOfCards = damageDeckOut(s, catalog);
  if (outOfCards !== null) {
    log(s, { kind: 'ruleAction', rule: 'loss', cards: [], players: [outOfCards] });
    endGame(s, [{ player: outOfCards, reason: 'deckOut' }]);
    return true;
  }
  for (const player of [s.active, other(s.active)]) {
    const due = dueInterrupts(s, player);
    if (due.length === 0) continue;
    if (due.length > 1) {
      s.pending = { kind: 'interruptOrder', player, options: due };
      return true;
    }
    performInterrupt(s, player, due[0] as InterruptKind);
    return true;
  }
  return false;
}

export function performInterrupt(s: GameState, player: PlayerId, kind: InterruptKind): void {
  if (kind === 'refresh') refresh(s, player);
  else s.pending = { kind: 'levelUp', player, options: s.players[player].clock.slice(0, LEVEL_UP_AT) };
}

/** CR 9.2.2: waiting room becomes the deck, shuffled, then the top card goes to clock. */
export function refresh(s: GameState, player: PlayerId): void {
  const p = s.players[player];
  if (p.deck.length !== 0 || p.waiting.length === 0) throw new EngineFault('refresh is not due');
  log(s, { kind: 'refresh', player });
  for (const card of [...p.waiting]) moveCard(s, card, { player, zone: 'deck' }, 'refresh');
  // Shuffle from a canonical order so reordering the waiting room cannot steer it (CR 3.2.4).
  const [shuffled, rng] = shuffle(s.rng, [...p.deck].sort());
  p.deck = shuffled;
  s.rng = rng;
  log(s, { kind: 'shuffle', player });
  const top = topOf(p, 'deck');
  if (top === undefined) throw new EngineFault('refresh produced an empty deck');
  moveCard(s, top, { player, zone: 'clock' }, 'refreshClock');
}

/** CR 9.3.2: the chosen card (one of the bottom seven) goes to level, the other six to the waiting room. */
export function resolveLevelUp(s: GameState, player: PlayerId, chosen: CardId, options: readonly CardId[]): void {
  moveCard(s, chosen, { player, zone: 'level' }, 'levelUp');
  for (const card of options) {
    if (card !== chosen) moveCard(s, card, ownersZone(s, card, 'waiting'), 'levelUp');
  }
}

// --- Check timing (CR 8.5.1) --------------------------------------------------------

function lossesDue(s: GameState): { player: PlayerId; reason: LossReason }[] {
  const losers: { player: PlayerId; reason: LossReason }[] = [];
  for (const player of [0, 1] as const) {
    const p = s.players[player];
    if (p.level.length >= LOSING_LEVEL) losers.push({ player, reason: 'level4' });
    else if (p.deck.length === 0 && p.waiting.length === 0) losers.push({ player, reason: 'deckOut' });
  }
  return losers;
}

/**
 * One pass of a check timing. Performs every check-type rule action that is
 * due right now, simultaneously, and queues another pass if anything happened
 * (CR 8.5.1.1). With no rule action due, plays one standby automatic ability,
 * turn player first, then comes back here (CR 8.5.1.2-8.5.1.3).
 */
export function checkTiming(s: GameState, catalog: CardCatalog, task: Extract<Task, { t: 'check' }>): void {
  if (!task.again) log(s, { kind: 'checkTiming' });

  const losers = lossesDue(s);
  if (losers.length > 0) {
    log(s, { kind: 'ruleAction', rule: 'loss', cards: [], players: losers.map((l) => l.player) });
    endGame(s, losers);
    return;
  }

  // Collect everything due from one snapshot, then move it all (CR 9.1.2.2.1).
  const removals: { card: CardId; rule: 'insufficientPower' | 'illegalCard' | 'extraCards' }[] = [];
  for (const player of [0, 1] as const) {
    const p = s.players[player];
    p.stage.forEach((cards) => {
      const characters = cards.filter((c) => defOf(s, catalog, c.id).kind === 'character');
      for (const c of cards) {
        if (defOf(s, catalog, c.id).kind !== 'character') removals.push({ card: c.id, rule: 'illegalCard' });
      }
      // CR 9.6.2: only the most recently placed character stays; ties all go.
      if (characters.length > 1) {
        const latest = Math.max(...characters.map((c) => c.placedAt));
        const newest = characters.filter((c) => c.placedAt === latest);
        const keep = newest.length === 1 ? newest[0]?.id : undefined;
        for (const c of characters) if (c.id !== keep) removals.push({ card: c.id, rule: 'extraCards' });
      }
      // CR 9.5.1: power 0 or less, counting effects on the card.
      for (const c of characters) {
        if (currentPower(s, catalog, c.id) <= 0) removals.push({ card: c.id, rule: 'insufficientPower' });
      }
    });
    const climaxes = p.climax.filter((c) => defOf(s, catalog, c.id).kind === 'climax');
    for (const c of p.climax) {
      if (defOf(s, catalog, c.id).kind !== 'climax') removals.push({ card: c.id, rule: 'illegalCard' });
    }
    if (climaxes.length > 1) {
      const latest = Math.max(...climaxes.map((c) => c.placedAt));
      const newest = climaxes.filter((c) => c.placedAt === latest);
      const keep = newest.length === 1 ? newest[0]?.id : undefined;
      for (const c of climaxes) if (c.id !== keep) removals.push({ card: c.id, rule: 'extraCards' });
    }
  }

  const again: Task = task.mark ? { t: 'check', mark: task.mark, again: true } : { t: 'check', again: true };
  if (removals.length === 0) {
    collectTriggers(s, catalog);
    if (playStandby(s, catalog, again) && task.mark === 'endPhase') s.flags.endCheckResolved = true;
    return;
  }

  const unique = [...new Map(removals.map((r) => [r.card, r])).values()];
  for (const rule of ['illegalCard', 'extraCards', 'insufficientPower'] as const) {
    const cards = unique.filter((r) => r.rule === rule).map((r) => r.card);
    if (cards.length === 0) continue;
    const players = [...new Set(cards.map((c) => s.cards[c]?.owner ?? 0))];
    log(s, { kind: 'ruleAction', rule, cards, players });
  }
  for (const r of unique) moveCard(s, r.card, ownersZone(s, r.card, 'waiting'), 'ruleAction');
  if (task.mark === 'endPhase') s.flags.endCheckResolved = true;
  s.tasks.unshift(again);
}
