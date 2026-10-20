// What the app shows, built for one player: the board, the decision in front
// of them, the handoff screen and the result. These models never contain the
// seed, the random generator state or a card the player cannot see.

import { actionKey, legalActions, other, projectView } from '../engine';
import type { CardId, GameState, PlayerId, Slot } from '../engine';
import type { DescribeContext } from './describe';
import { describeAction, pendingWords } from './describe';
import type { LogLine } from './log';
import { logLines, resultText } from './log';
import type { Choice, Prompt } from './prompt';
import { buildPrompt } from './prompt';
import { canUndo, needsHandoff, toAct, viewer } from './session';
import type { CardDetail, CardTile, StageTile } from './tiles';
import { cardDetail as detailOf, stageTileOf, tileOf } from './tiles';
import type { CardSource, Memory, Mode, Seat, Session } from './types';
import { cardName, PHASE_NAMES, SLOT_NAMES, STEP_NAMES, who } from './words';

export interface SlotView {
  readonly slot: Slot;
  readonly label: string;
  readonly card: StageTile | null;
}

export interface Side {
  readonly player: PlayerId;
  readonly name: string;
  readonly handCount: number;
  readonly deckCount: number;
  readonly stockCount: number;
  readonly waitingCount: number;
  readonly clockCount: number;
  readonly levelCount: number;
  readonly memoryCount: number;
  /** Null for the other player's hand. */
  readonly hand: readonly CardTile[] | null;
  readonly waiting: readonly CardTile[];
  readonly clock: readonly CardTile[];
  readonly levelCards: readonly CardTile[];
  readonly memory: readonly CardTile[];
  readonly resolution: readonly CardTile[];
  readonly climax: CardTile | null;
  /** In screen order: your front row 1-2-3 and back row 4-5; the opponent's mirrored (3-2-1, 5-4). */
  readonly front: readonly SlotView[];
  readonly back: readonly SlotView[];
}

export interface Screen {
  readonly viewer: PlayerId;
  readonly mode: Mode;
  readonly header: { readonly turn: number; readonly turnOf: string; readonly phase: string; readonly step: string | null; readonly yourTurn: boolean };
  readonly you: Side;
  readonly opponent: Side;
  /** The attack in progress, in words. */
  readonly attack: string | null;
  /** The ability being resolved. */
  readonly resolving: { readonly name: string; readonly text: string } | null;
  readonly look: { readonly who: string; readonly count: number; readonly cards: readonly CardTile[] | null } | null;
  /** The viewer's decision, or null while someone else decides. */
  readonly prompt: Prompt | null;
  /** "Computer is deciding what to play", while the other player decides. */
  readonly waiting: string | null;
  /** What happened since the viewer last acted. */
  readonly recent: readonly LogLine[];
  readonly canUndo: boolean;
}

export interface HandoffModel {
  readonly to: PlayerId;
  readonly toName: string;
  /** Public words only: turn, phase and step. */
  readonly context: string;
  /** Before the first decision: who goes first. */
  readonly first: string | null;
}

export interface GameOverModel {
  readonly title: string;
  readonly text: string;
  readonly turns: number;
}

interface Built {
  readonly cards: CardSource;
  readonly seats: readonly [Seat, Seat];
  readonly mode: Mode;
  readonly memory: Memory;
  readonly mark: number;
  readonly canUndo: boolean;
}

const RECENT = 30;

function context(state: GameState, viewerId: PlayerId, b: Built): DescribeContext {
  return { cards: b.cards, memory: b.memory, viewer: viewerId, seats: b.seats, view: projectView(state, viewerId, { catalog: b.cards.catalog, logSinceTurn: Number.MAX_SAFE_INTEGER }), state };
}

function side(ctx: DescribeContext, p: PlayerId): Side {
  const v = ctx.view.players[p];
  const tiles = (cards: readonly { id: CardId; def: string }[]) => cards.map((c) => tileOf(ctx.cards, c.id, c.def));
  const slot = (s: Slot): SlotView => {
    const c = v.stage[s - 1]?.[0];
    return { slot: s, label: SLOT_NAMES[s], card: c ? stageTileOf(ctx.cards, c.id, c.def, c.orientation, c.power ?? 0, c.soul ?? 0) : null };
  };
  const mine = p === ctx.viewer;
  const climax = v.climax[0];
  return {
    player: p,
    name: who(ctx, p),
    handCount: v.counts.hand,
    deckCount: v.counts.deck,
    stockCount: v.counts.stock,
    waitingCount: v.counts.waiting,
    clockCount: v.counts.clock,
    levelCount: v.counts.level,
    memoryCount: v.counts.memory,
    hand: v.hand ? tiles(v.hand) : null,
    waiting: tiles(v.waiting),
    clock: tiles(v.clock),
    levelCards: tiles(v.level),
    memory: tiles(v.memory),
    resolution: tiles(v.resolution),
    climax: climax ? tileOf(ctx.cards, climax.id, climax.def) : null,
    front: (mine ? [1, 2, 3] : [3, 2, 1]).map((s) => slot(s as Slot)),
    back: (mine ? [4, 5] : [5, 4]).map((s) => slot(s as Slot)),
  };
}

function attackWords(ctx: DescribeContext): string | null {
  const a = ctx.view.attack;
  if (!a) return null;
  const attacker = cardName(ctx, a.attacker.card);
  const owner = who(ctx, ctx.view.active);
  if (a.type === 'direct') return `${owner === 'You' ? 'Your' : `${owner}’s`} ${attacker} makes a direct attack.`;
  const target = a.facing ? cardName(ctx, a.facing.card) : 'a character';
  return `${owner === 'You' ? 'Your' : `${owner}’s`} ${attacker} makes a ${a.type === 'frontal' ? 'front' : 'side'} attack on ${target}.`;
}

function resolvingWords(ctx: DescribeContext): Screen['resolving'] {
  const r = ctx.view.resolving;
  if (!r) return null;
  const detail = detailOf(ctx.cards, r.def);
  if (!detail) return null;
  const line = r.index !== null ? (detail.lines[r.index] ?? '') : detail.lines.join(' ');
  return { name: cardName(ctx, r.card) === 'a card' ? detail.name : cardName(ctx, r.card), text: line };
}

/** The board for `viewerId`. `state` must be the session's state; nothing hidden from the viewer is copied out. */
export function buildScreen(state: GameState, viewerId: PlayerId, b: Built): Screen {
  const ctx = context(state, viewerId, b);
  const view = ctx.view;
  const deciding = state.result === null ? (state.pending?.player ?? null) : null;
  let prompt: Prompt | null = null;
  let waiting: string | null = null;
  if (deciding === viewerId && state.pending) prompt = buildPrompt(state.pending, legalActions(state, b.cards.catalog, viewerId), ctx);
  else if (deciding !== null) waiting = `${who(ctx, deciding)} ${state.pending ? pendingWords(state.pending.kind) : 'is deciding'}…`;
  return {
    viewer: viewerId,
    mode: b.mode,
    header: {
      turn: view.turn,
      turnOf: view.turn === 0 ? 'Setup' : who(ctx, view.active),
      phase: PHASE_NAMES[view.phase],
      step: view.step ? STEP_NAMES[view.step] : null,
      yourTurn: view.turn > 0 && view.active === viewerId,
    },
    you: side(ctx, viewerId),
    opponent: side(ctx, other(viewerId)),
    attack: attackWords(ctx),
    resolving: resolvingWords(ctx),
    look: view.look ? { who: who(ctx, view.look.player), count: view.look.count, cards: view.look.cards ? view.look.cards.map((c) => tileOf(b.cards, c.id, c.def)) : null } : null,
    prompt,
    waiting,
    recent: logLines(state.log.slice(b.mark), ctx).slice(-RECENT),
    canUndo: b.canUndo,
  };
}

function built(s: Session, p: PlayerId): Built {
  return { cards: s.cards, seats: s.seats, mode: s.mode, memory: s.game.memory[p], mark: s.game.marks[p], canUndo: canUndo(s) };
}

/** The board for the player holding the phone, or null while a handoff is due. */
export function screenFor(s: Session): Screen | null {
  const p = viewer(s);
  if (p === null || needsHandoff(s) !== null) return null;
  return buildScreen(s.game.state, p, built(s, p));
}

/** Hot-seat: what the handoff screen shows. Public facts only. */
export function handoffScreen(s: Session): HandoffModel | null {
  const to = needsHandoff(s);
  if (to === null) return null;
  const st = s.game.state;
  const parts = st.turn === 0 ? ['Setup', 'Mulligan'] : [`Turn ${st.turn}`, PHASE_NAMES[st.phase], ...(st.step ? [STEP_NAMES[st.step]] : [])];
  const first = st.turn === 0 && s.game.actions.length === 0 ? `${s.seats[st.starting].name} goes first (chosen at random).` : null;
  return { to, toName: s.seats[to].name, context: parts.join(' · '), first };
}

/** The result, once the game is over. */
export function gameOverScreen(s: Session): GameOverModel | null {
  const r = s.game.state.result;
  if (r === null) return null;
  const p = s.holder ?? 0;
  const names = { cards: s.cards, memory: s.game.memory[p], viewer: p, seats: s.seats };
  const title = r.kind === 'draw' ? 'Draw' : s.mode === 'computer' ? (r.winner === p ? 'You win!' : 'The computer wins') : `${s.seats[r.winner].name} wins!`;
  const text = resultText(names, r, s.mode === 'hotseat');
  return { title, text, turns: s.game.state.turn };
}

/** The whole log for the player holding the phone (most recent `limit` lines). */
export function logFor(s: Session, limit = 400): LogLine[] {
  const p = viewer(s);
  if (p === null) return [];
  const names = { cards: s.cards, memory: s.game.memory[p], viewer: p, seats: s.seats };
  return logLines(s.game.state.log, names).slice(-limit);
}

/** The mulligan button for putting back exactly `discard` (card ids from the prompt), or null if that is not a legal choice. */
export function mulliganChoice(s: Session, discard: readonly CardId[]): Choice | null {
  const p = viewer(s);
  if (p === null || toAct(s) !== p || s.game.state.pending?.kind !== 'mulligan') return null;
  const key = actionKey({ type: 'MULLIGAN', player: p, discard: [...discard] });
  const action = legalActions(s.game.state, s.cards.catalog, p).find((a) => actionKey(a) === key);
  if (!action) return null;
  const ctx = context(s.game.state, p, built(s, p));
  const d = describeAction(action, s.game.state.pending, ctx);
  return { key, label: d.label, ...(d.detail !== undefined ? { detail: d.detail } : {}), tone: 'primary' };
}

/** Everything printed on a card definition, for the card detail sheet. */
export function cardDetail(s: Session, defId: string): CardDetail | null {
  return detailOf(s.cards, defId);
}
