// What one player may see (CR 3.1.2-3.1.3, 3.2.2, 3.3.2, 3.10.2).
// Hidden zones show only their card count. Deck and stock are hidden from
// everyone, the hand from the opponent. Card instance ids are never exposed for
// hidden cards, since an id could reveal which decklist slot a card came from.

import type {
  AttackState,
  AttackStep,
  CardId,
  GameEvent,
  GameResult,
  GameState,
  Orientation,
  Pending,
  Phase,
  PlayerId,
  TurnEffect,
  ZoneName,
  ZoneRef,
} from '../model/types';
import { deepClone } from '../core/clone';
import { isPublicZone } from '../core/zones';
import { lookedInDeck } from '../rules/frame';

export const HIDDEN = '?';

export interface VisibleCard {
  id: CardId;
  def: string;
}
export interface VisibleStageCard extends VisibleCard {
  orientation: Orientation;
}
export interface PlayerView {
  player: PlayerId;
  counts: Record<ZoneName, number>;
  /** Null when the viewer may not see this hand. */
  hand: VisibleCard[] | null;
  waiting: VisibleCard[];
  clock: VisibleCard[];
  level: VisibleCard[];
  memory: VisibleCard[];
  resolution: VisibleCard[];
  climax: VisibleCard[];
  /** Index i is stage position i + 1. */
  stage: VisibleStageCard[][];
}
export type PendingView = Pending | { kind: Pending['kind']; player: PlayerId; redacted: true };

export interface GameView {
  viewer: PlayerId;
  turn: number;
  phase: Phase;
  /** Attack Phase step, or null. */
  step: AttackStep | null;
  active: PlayerId;
  starting: PlayerId;
  result: GameResult | null;
  /** The current attack (all public). */
  attack: AttackState | null;
  /** Power and soul changes from one-shot effects (public). */
  effects: TurnEffect[];
  /** The ability being resolved (public), or null. */
  resolving: { kind: 'event' | 'activated' | 'automatic'; master: PlayerId; card: CardId; def: string; index: number | null } | null;
  /** Deck cards a player is looking at (CR 4.8). Only the looker gets `cards`; everyone sees how many. */
  look: { player: PlayerId; count: number; cards: VisibleCard[] | null } | null;
  pending: PendingView | null;
  players: [PlayerView, PlayerView];
  log: GameEvent[];
}

export function canSee(viewer: PlayerId, ref: ZoneRef): boolean {
  if (isPublicZone(ref.zone)) return true;
  return ref.zone === 'hand' && ref.player === viewer;
}

function playerView(s: GameState, owner: PlayerId, viewer: PlayerId): PlayerView {
  const p = s.players[owner];
  const show = (ids: readonly CardId[]): VisibleCard[] => ids.map((id) => ({ id, def: s.cards[id]?.def ?? HIDDEN }));
  return {
    player: owner,
    counts: {
      deck: p.deck.length,
      hand: p.hand.length,
      waiting: p.waiting.length,
      clock: p.clock.length,
      level: p.level.length,
      stock: p.stock.length,
      memory: p.memory.length,
      resolution: p.resolution.length,
      stage: p.stage.reduce((n, cards) => n + cards.length, 0),
      climax: p.climax.length,
    },
    hand: owner === viewer ? show(p.hand) : null,
    waiting: show(p.waiting),
    clock: show(p.clock),
    level: show(p.level),
    memory: show(p.memory),
    resolution: show(p.resolution),
    climax: show(p.climax.map((c) => c.id)),
    stage: p.stage.map((cards) => cards.map((c) => ({ id: c.id, def: s.cards[c.id]?.def ?? HIDDEN, orientation: c.orientation }))),
  };
}

/**
 * A move into a zone the viewer cannot see hides which card it was. That
 * covers hidden-to-hidden moves (an opponent's draw) and also public-to-hidden
 * moves, whose order must stay secret (CR 3.1.5.1); the number of moves stays
 * visible.
 */
function redactEvent(e: GameEvent, viewer: PlayerId): GameEvent {
  if (e.kind === 'move' && !canSee(viewer, e.to)) return { ...e, card: HIDDEN };
  // Looked-at cards are seen by the looker only (CR 4.8).
  if (e.kind === 'look' && e.player !== viewer) return { ...e, cards: e.cards.map(() => HIDDEN) };
  // A card picked from a hidden zone (a deck or hand) must not be named to the other player.
  if (e.kind === 'action' && e.action.type === 'CHOOSE_CARD' && e.action.player !== viewer) return { ...e, action: { ...e.action, card: HIDDEN } };
  if (e.kind === 'action' && e.action.type === 'REORDER' && e.action.zone === 'hand' && e.action.player !== viewer) {
    return { ...e, action: { ...e.action, order: [] } };
  }
  return e;
}

/**
 * Redacts a list of events for one player. applyAction returns events as the
 * engine saw them (everything visible); a UI must pass them through here
 * before showing them.
 */
export function projectEvents(events: readonly GameEvent[], viewer: PlayerId): GameEvent[] {
  return events.map((e) => redactEvent(e, viewer));
}

function resolvingView(state: GameState): GameView['resolving'] {
  const f = state.resolving;
  return f === null ? null : { kind: f.kind, master: f.master, card: f.source.card, def: f.def, index: f.index };
}

function lookView(state: GameState, viewer: PlayerId): GameView['look'] {
  const f = state.resolving;
  if (!f?.look) return null;
  const cards = lookedInDeck(state, f);
  return { player: f.look.player, count: cards.length, cards: viewer === f.look.player ? cards.map((id) => ({ id, def: state.cards[id]?.def ?? HIDDEN })) : null };
}

/** The game as one player may see it. Returns fresh objects; changing them cannot affect the state. */
export function projectView(state: GameState, viewer: PlayerId): GameView {
  const pending = state.pending === null ? null : deepClone(state.pending);
  return {
    viewer,
    turn: state.turn,
    phase: state.phase,
    step: state.step,
    active: state.active,
    starting: state.starting,
    result: state.result === null ? null : deepClone(state.result),
    attack: state.attack === null ? null : deepClone(state.attack),
    effects: deepClone(state.effects),
    resolving: resolvingView(state),
    look: lookView(state, viewer),
    pending: pending === null ? null : pending.player === viewer ? pending : { kind: pending.kind, player: pending.player, redacted: true },
    players: [playerView(state, 0, viewer), playerView(state, 1, viewer)],
    log: projectEvents(state.log, viewer),
  };
}
