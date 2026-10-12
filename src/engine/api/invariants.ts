// Structural invariants that must hold in every state the engine returns.
// Fuzz tests call this after every action.

import { lookupDef } from '../model/cards';
import { LOSING_LEVEL } from '../rules/ruleActions';
import type { CardCatalog, GameState } from '../model/types';
import { allCardIds } from '../core/zones';

export function checkInvariants(s: GameState, catalog: CardCatalog): string[] {
  const v: string[] = [];

  // Card conservation: every card is in exactly one zone, and nothing unknown is anywhere.
  const seen = new Map<string, number>();
  for (const player of [0, 1] as const) for (const id of allCardIds(s.players[player])) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(s.cards)) {
    const n = seen.get(id) ?? 0;
    if (n !== 1) v.push(`card ${id} is in ${n} zones`);
  }
  for (const id of seen.keys()) if (!s.cards[id]) v.push(`unknown card ${id} in a zone`);
  for (const inst of Object.values(s.cards)) if (!lookupDef(catalog, inst.def)) v.push(`card ${inst.id} has unknown definition ${inst.def}`);

  // Game over iff a result exists; otherwise someone must have a decision (no soft-lock).
  if ((s.result !== null) !== (s.phase === 'gameOver')) v.push('result and phase disagree about game over');
  if (s.result !== null && s.pending !== null) v.push('game is over but a decision is pending');
  if (s.result === null && s.pending === null) v.push('game is not over but no decision is pending');

  // Attack bookkeeping exists only in the Attack Phase. A finished game keeps where it stopped.
  if (s.result === null && (s.step !== null) !== (s.phase === 'attack')) v.push(`step ${String(s.step)} does not match phase ${s.phase}`);
  if (s.result === null && s.attack !== null && s.phase !== 'attack') v.push('an attack exists outside the Attack Phase');

  // At ordinary decision points the rule actions and standby abilities have already run.
  const settled = s.pending !== null && (s.pending.kind === 'play' || s.pending.kind === 'clock' || s.pending.kind === 'discard' || s.pending.kind === 'attack');
  if (settled) {
    if (s.damage !== null) v.push('a damage process is still open at a decision point');
    if (s.triggerCheck !== null) v.push('a trigger check is still open at a decision point');
    if (s.standby.length > 0) v.push(`${s.standby.length} standby abilities were not played`);
  }
  for (const player of [0, 1] as const) {
    const p = s.players[player];
    if (p.stage.length !== 5) v.push(`player ${player} stage has ${p.stage.length} positions`);
    if (settled) {
      p.stage.forEach((cards, i) => {
        if (cards.length > 1) v.push(`player ${player} position ${i + 1} holds ${cards.length} cards`);
      });
      if (p.climax.length > 1) v.push(`player ${player} climax area holds ${p.climax.length} cards`);
      if (p.resolution.length > 0) v.push(`player ${player} resolution zone holds ${p.resolution.length} cards`);
      if (s.result === null && p.level.length >= LOSING_LEVEL) v.push(`player ${player} has level ${p.level.length} but has not lost`);
    }
    if (s.result === null && p.deck.length === 0 && p.waiting.length > 0 && s.pending?.kind !== 'levelUp' && s.pending?.kind !== 'interruptOrder') {
      v.push(`player ${player} has an empty deck that was not refreshed`);
    }
  }

  if (s.pending && s.pending.player !== 0 && s.pending.player !== 1) v.push('pending decision has no valid player');
  return v;
}
