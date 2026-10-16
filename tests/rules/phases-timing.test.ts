// Rule tests for M1: turn structure and phases (TURN, STAND, DRAW, CLOCK,
// MAIN, CLIMAX, END), check timing and play timing (CONC-10..13, ABL-07,
// ABL-09). Every title starts with the rules-matrix id(s) it covers.
//
// Most assertions read the event log, because these rules are about ORDER:
// which trigger condition, check timing, rule action, play timing and phase
// comes before which.
import { describe, expect, it } from 'vitest';

import { applyAction, createGame, legalActions, locate, nextInt, other, seedRng, validate } from '../../src/engine';
import type { Action, CardCatalog, CardId, GameEvent, GameState, Orientation, Phase, PlayerId, Slot } from '../../src/engine';
import { act, cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import { catalog, legalDeck } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const cat: CardCatalog = {
  ...catalog,
  // Level 0 character that costs 1 stock (for "as long as the cost can be paid").
  PC1: { id: 'PC1', name: 'Amber Porter', kind: 'character', color: 'yellow', level: 0, cost: 1, power: 3000, soul: 1 },
};

// --- Helpers -----------------------------------------------------------------

/** A plain deck so nobody decks out. */
const deck = (n = 10): string[] => Array.from({ length: n }, () => 'G0');
const many = (def: string, n: number): string[] => Array.from({ length: n }, () => def);

/** A short readable label for an event; 'played' bookkeeping is left out by `flow`. */
function tag(e: GameEvent): string {
  switch (e.kind) {
    case 'setup':
      return 'setup';
    case 'shuffle':
      return 'shuffle';
    case 'move':
      return `move:${e.reason}`;
    case 'turnStart':
      return `turnStart:${e.player}`;
    case 'phase':
      return `phase:${e.phase}`;
    case 'trigger':
      return `trigger:${e.condition}`;
    case 'checkTiming':
      return 'check';
    case 'playTiming':
      return `playTiming:${e.player}:${e.window}`;
    case 'action':
      return `action:${e.action.type}`;
    case 'played':
      return 'played';
    case 'orientation':
      return `orientation:${e.orientation}`;
    case 'refresh':
      return 'refresh';
    case 'ruleAction':
      return `ruleAction:${e.rule}`;
    case 'gameOver':
      return 'gameOver';
    case 'step':
      return `step:${e.step}`;
    case 'attack':
    case 'auto':
    case 'backup':
    case 'battle':
    case 'damage':
    case 'damageCanceled':
    case 'damageTaken':
    case 'effectsExpired':
    case 'icon':
    case 'modifier':
    case 'triggerCheck':
    case 'ability':
    case 'abilityLapsed':
    case 'effect':
    case 'optional':
    case 'chosen':
    case 'look':
    case 'lookEnd':
    case 'deckArranged':
      return e.kind;
  }
}

const flow = (events: readonly GameEvent[]): string[] => events.map(tag).filter((t) => t !== 'played');
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);

/** The events from the nth entry into `phase` up to (not including) the next phase or turn start. */
function phaseEvents(events: readonly GameEvent[], phase: Phase, nth = 0): GameEvent[] {
  const starts = events.flatMap((e, i) => (e.kind === 'phase' && e.phase === phase ? [i] : []));
  const start = starts[nth];
  if (start === undefined) throw new Error(`phase ${phase} #${nth} was never entered`);
  const end = events.findIndex((e, i) => i > start && (e.kind === 'phase' || e.kind === 'turnStart'));
  return events.slice(start, end < 0 ? events.length : end);
}

type MoveEvent = Extract<GameEvent, { kind: 'move' }>;
const moves = (events: readonly GameEvent[]): MoveEvent[] => events.filter((e): e is MoveEvent => e.kind === 'move');
const indicesOfTag = (events: readonly GameEvent[], t: string): number[] => events.flatMap((e, i) => (tag(e) === t ? [i] : []));

/** Every stage position's card definitions, position 1 first. */
function stageDefs(s: GameState, p: PlayerId): string[][] {
  return s.players[p].stage.map((cards) => cards.map((c) => s.cards[c.id]?.def ?? '?'));
}

function orientationOf(s: GameState, id: CardId): Orientation | undefined {
  for (const p of [0, 1] as const) for (const cards of s.players[p].stage) for (const c of cards) if (c.id === id) return c.orientation;
  return undefined;
}

function slotOf(s: GameState, id: CardId): Slot | undefined {
  const loc = locate(s, id);
  return loc?.zone === 'stage' ? loc.slot : undefined;
}

/** The error code validate gives for an action, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const v = validate(s, cat, action);
  return v.ok ? 'ok' : v.error.code;
}

const mainPlay = (player: PlayerId) => ({ kind: 'play', player, window: 'main' }) as const;

/** Answers every decision in the simplest way: keep the hand, never clock, pass every play timing. */
function passiveAction(s: GameState): Action {
  const pending = s.pending;
  if (!pending) throw new Error('no decision pending');
  if (pending.kind === 'mulligan') return { type: 'MULLIGAN', player: pending.player, discard: [] };
  if (pending.kind === 'clock') return { type: 'CLOCK', player: pending.player, card: null };
  if (pending.kind === 'play') return { type: 'PASS', player: pending.player };
  const first = legalActions(s, cat)[0];
  if (!first) throw new Error(`no legal action for ${pending.kind}`);
  return first;
}

/** Seeded random legal play from a real game; returns every state and the action taken from it. */
function randomGame(seed: string, maxSteps = 300): { states: GameState[]; actions: Action[] } {
  const created = createGame({ seed, decks: [legalDeck('yellow'), legalDeck('red')] }, catalog);
  if (!created.ok) throw new Error(JSON.stringify(created.errors));
  let s = created.state;
  let rng = seedRng(`phases-${seed}`);
  const states = [s];
  const actions: Action[] = [];
  for (let i = 0; i < maxSteps && !s.result; i++) {
    const legal = legalActions(s, catalog);
    const [pick, next] = nextInt(rng, legal.length);
    rng = next;
    const action = legal[pick] as Action;
    s = act(s, catalog, action);
    actions.push(action);
    states.push(s);
  }
  return { states, actions };
}

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'];

// --- 6.1 Turn procedure --------------------------------------------------------

describe('6.1 turn procedure', () => {
  it('[TURN-01] from the first turn on, players alternate as turn player and every turn runs Stand, Draw, Clock, Main, Climax, Attack, End in that order', () => {
    const created = createGame({ seed: 'turn-order', decks: [legalDeck('yellow'), legalDeck('red')] }, cat);
    if (!created.ok) throw new Error('setup failed');
    let s = created.state;
    const starting = s.starting;
    while (!s.result && s.turn < 5) {
      // Only the turn player is asked for phase decisions.
      if (s.pending?.kind === 'clock' || s.pending?.kind === 'play') expect(s.pending.player).toBe(s.active);
      s = act(s, cat, passiveAction(s));
    }
    const turnStarts = s.log.flatMap((e, i) => (e.kind === 'turnStart' ? [{ i, player: e.player }] : []));
    expect(turnStarts.map((t) => t.player)).toEqual([starting, other(starting), starting, other(starting), starting]);
    // Phases of each complete turn (turns 1-4), in order.
    for (let k = 0; k < 4; k++) {
      const from = (turnStarts[k] as { i: number }).i;
      const to = (turnStarts[k + 1] as { i: number }).i;
      const phases = s.log.slice(from, to).flatMap((e) => (e.kind === 'phase' ? [e.phase] : []));
      expect(phases).toEqual(['stand', 'draw', 'clock', 'main', 'climax', 'attack', 'end']);
    }
  });

  it('[TURN-01] after the End Phase the turn passes to the opponent, who starts again from the Stand Phase (either player as turn player)', () => {
    for (const active of [0, 1] as const) {
      const s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck(), hand: ['R0'] }], active, turn: 3, start: 'end' });
      const t = flow(s.log).filter((x) => x.startsWith('phase:') || x.startsWith('turnStart:'));
      expect(t).toEqual(['phase:end', `turnStart:${other(active)}`, 'phase:stand', 'phase:draw', 'phase:clock']);
      expect(s.active).toBe(other(active));
      expect(s.turn).toBe(4);
      expect(s.pending).toEqual({ kind: 'clock', player: other(active) });
    }
  });
});

// --- 6.2 Stand Phase -----------------------------------------------------------

describe('6.2 Stand Phase', () => {
  it('[STAND-01] both start triggers are met, then a check timing resolves rule actions before any character stands, then another check timing before the Draw Phase', () => {
    const s = makeState(cat, {
      players: [
        {
          deck: deck(),
          stage: {
            1: { def: 'Y0', orientation: 'rest' },
            2: { def: 'Z0', orientation: 'rest' }, // power 0: removed by rule action
            3: [
              { def: 'R0', orientation: 'rest' }, // placed first: removed as an extra card
              { def: 'B0', orientation: 'reverse' },
            ],
          },
        },
        { deck: deck() },
      ],
      start: 'stand',
    });
    const seg = phaseEvents(s.log, 'stand');
    const z0 = cardIn(s, 0, 'waiting', 'Z0');
    const r0 = cardIn(s, 0, 'waiting', 'R0');
    const y0 = cardIn(s, 0, 'stage', 'Y0');
    const b0 = cardIn(s, 0, 'stage', 'B0');

    const checks = indicesOfTag(seg, 'check');
    expect(checks).toHaveLength(2);
    const [firstCheck, secondCheck] = checks as [number, number];
    const triggers = seg.flatMap((e, i) => (e.kind === 'trigger' ? [{ i, c: e.condition }] : []));
    expect(triggers.map((t) => t.c).sort()).toEqual(['standPhaseStart', 'turnStart']);
    for (const t of triggers) expect(t.i).toBeLessThan(firstCheck);

    const stood = seg.flatMap((e, i) => (e.kind === 'orientation' ? [{ i, card: e.card }] : []));
    expect(stood.map((x) => x.card).sort()).toEqual([y0, b0].sort());
    const firstStand = Math.min(...stood.map((x) => x.i));
    const lastStand = Math.max(...stood.map((x) => x.i));

    // Rule actions belong to the first check timing: after it starts, before anything stands.
    const ruleMoves = seg.flatMap((e, i) => (e.kind === 'move' && e.reason === 'ruleAction' ? [{ i, card: e.card }] : []));
    expect(ruleMoves.map((m) => m.card).sort()).toEqual([z0, r0].sort());
    for (const m of ruleMoves) {
      expect(m.i).toBeGreaterThan(firstCheck);
      expect(m.i).toBeLessThan(firstStand);
    }
    // The second check timing follows the standing and is the last thing before the Draw Phase.
    expect(secondCheck).toBeGreaterThan(lastStand);
    expect(secondCheck).toBe(seg.length - 1);
    const next = s.log[s.log.indexOf(seg[seg.length - 1] as GameEvent) + 1];
    expect(next && tag(next)).toBe('phase:draw');
  });

  it('[STAND-02] the turn player stands every one of their characters; the non-turn player\'s characters keep their orientation', () => {
    for (const active of [0, 1] as const) {
      const side = () => ({
        deck: deck(),
        stage: {
          1: { def: 'Y0', orientation: 'rest' as const },
          2: { def: 'R0', orientation: 'reverse' as const },
          3: 'B0',
          5: { def: 'G0', orientation: 'rest' as const },
        },
      });
      const s = makeState(cat, { players: [side(), side()], active, start: 'stand' });
      const turn = s.players[active].stage.flat();
      const opp = s.players[other(active)].stage.flat();
      expect(turn.map((c) => c.orientation)).toEqual(['stand', 'stand', 'stand', 'stand']);
      expect(opp.map((c) => c.orientation)).toEqual(['rest', 'reverse', 'stand', 'rest']);

      // Standing is a change of state, not a move: no card left its position or became a new object.
      const seg = phaseEvents(s.log, 'stand');
      expect(moves(seg)).toEqual([]);
      expect(stageDefs(s, active)).toEqual([['Y0'], ['R0'], ['B0'], [], ['G0']]);
      for (const c of turn) expect(s.cards[c.id]?.epoch).toBe(0);
      // Only the turn player's rested / reversed characters changed state.
      const changed = seg.flatMap((e) => (e.kind === 'orientation' ? [e.card] : []));
      expect(changed.sort()).toEqual(
        [cardIn(s, active, 'stage', 'Y0'), cardIn(s, active, 'stage', 'R0'), cardIn(s, active, 'stage', 'G0')].sort(),
      );
    }
  });
});

// --- 6.3 Draw Phase ------------------------------------------------------------

describe('6.3 Draw Phase', () => {
  it('[DRAW-01] the draw-phase trigger and a check timing come first, then the draw, then a check timing, then the Clock Phase', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), stage: { 1: 'Z0' } }, { deck: deck() }],
      start: 'draw',
    });
    expect(flow(phaseEvents(s.log, 'draw'))).toEqual([
      'phase:draw',
      'trigger:drawPhaseStart',
      'check',
      'ruleAction:insufficientPower', // the opening check timing resolves before the draw
      'move:ruleAction',
      'move:draw',
      'check',
    ]);
    expect(flow(s.log)).toContain('phase:clock');
  });

  it('[DRAW-01] a loss caused by the draw (refresh, then level up to 4) is found by the check timing after the draw, so the Clock Phase never starts', () => {
    const spec = (levels: number) =>
      makeState(cat, {
        players: [
          { deck: ['G0'], waiting: ['G0', 'G0', 'G0'], clock: many('G0', 6), level: many('Y0', levels) },
          { deck: deck() },
        ],
        start: 'draw',
      });

    const atRisk = spec(3);
    // The draw empties the deck; the refresh puts a seventh card into the clock and level up is offered.
    expect(atRisk.pending?.kind).toBe('levelUp');
    const lost = act(atRisk, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(atRisk, 0, 'clock', 'G0') });
    expect(lost.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
    const t = flow(lost.log);
    expect(t).not.toContain('phase:clock');
    const drawAt = t.indexOf('move:draw');
    const overAt = t.indexOf('gameOver');
    expect(t.slice(drawAt, overAt).filter((x) => x === 'check')).toHaveLength(1);
    expect(t[overAt - 2]).toBe('check');
    expect(t[overAt - 1]).toBe('ruleAction:loss');

    // Contrast: the same level up to level 3 leaves nothing to resolve, and play moves to the Clock Phase.
    const safe = spec(2);
    const ok = act(safe, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(safe, 0, 'clock', 'G0') });
    expect(ok.result).toBeNull();
    expect(ok.phase).toBe('clock');
    expect(ok.pending).toEqual({ kind: 'clock', player: 0 });
  });

  it('[DRAW-02] the turn player draws exactly one card, the top card of their own deck, without being asked', () => {
    for (const active of [0, 1] as const) {
      const side = (top: string) => ({ deck: ['G0', 'Y0', 'B0', top], hand: ['YE0'] });
      const s = makeState(cat, { players: [side('R0'), side('R1')], active, start: 'draw' });
      const top = active === 0 ? 'R0' : 'R1';
      expect(defsIn(s, active, 'hand')).toEqual(['YE0', top]);
      expect(defsIn(s, active, 'deck')).toEqual(['G0', 'Y0', 'B0']);
      // The non-turn player draws nothing.
      expect(defsIn(s, other(active), 'hand')).toEqual(['YE0']);
      expect(defsIn(s, other(active), 'deck')).toHaveLength(4);
      // One draw, and the first decision is the clock decision: drawing was not optional.
      const draws = moves(phaseEvents(s.log, 'draw')).filter((m) => m.reason === 'draw');
      expect(draws).toHaveLength(1);
      expect(draws[0]?.from).toEqual({ player: active, zone: 'deck' });
      expect(draws[0]?.to).toEqual({ player: active, zone: 'hand' });
      expect(s.pending).toEqual({ kind: 'clock', player: active });
    }
  });

  it('[DRAW-02] the starting player also draws in their very first turn', () => {
    const created = createGame({ seed: 'first-draw', decks: [legalDeck('yellow'), legalDeck('red')] }, cat);
    if (!created.ok) throw new Error('setup failed');
    let s = created.state;
    while (s.pending?.kind === 'mulligan') s = act(s, cat, passiveAction(s));
    expect(s.turn).toBe(1);
    expect(s.pending).toEqual({ kind: 'clock', player: s.starting });
    expect(s.players[s.starting].hand).toHaveLength(6);
    expect(s.players[s.starting].deck).toHaveLength(44);
    expect(s.players[other(s.starting)].hand).toHaveLength(5);
  });
});

// --- 6.4 Clock Phase -----------------------------------------------------------

describe('6.4 Clock Phase', () => {
  it('[CLOCK-01] the clock-phase trigger and a check timing come before the clock decision; after it, a check timing, then the Main Phase', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['Y0', 'R0'], stage: { 1: 'Z0' } }, { deck: deck() }],
      start: 'clock',
    });
    expect(flow(phaseEvents(s.log, 'clock'))).toEqual(['phase:clock', 'trigger:clockPhaseStart', 'check', 'ruleAction:insufficientPower', 'move:ruleAction']);
    expect(s.pending).toEqual({ kind: 'clock', player: 0 });

    const clocked = applyAction(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') });
    if (!clocked.ok) throw new Error(clocked.error.message);
    expect(flow(clocked.events)).toEqual([
      'action:CLOCK',
      'move:clock',
      'move:draw',
      'move:draw',
      'check',
      'phase:main',
      'trigger:mainPhaseStart',
      'check',
      'playTiming:0:main',
    ]);

    const declined = applyAction(s, cat, { type: 'CLOCK', player: 0, card: null });
    if (!declined.ok) throw new Error(declined.error.message);
    expect(flow(declined.events).slice(0, 3)).toEqual(['action:CLOCK', 'check', 'phase:main']);
  });

  it('[CLOCK-01] a loss caused by the clocked card (level up to 4) is found by the closing check timing, so the Main Phase never starts', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['Y0', 'R0'], clock: many('G0', 6), level: ['Y0', 'R0', 'B0'] }, { deck: deck() }],
      start: 'clock',
    });
    const leveling = act(s, cat, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') });
    expect(leveling.pending?.kind).toBe('levelUp');
    const lost = act(leveling, cat, { type: 'LEVEL_UP', player: 0, card: cardIn(leveling, 0, 'clock', 'G0') });
    expect(lost.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
    const loss = lost.log.find((e) => e.kind === 'ruleAction' && e.rule === 'loss');
    expect(loss?.phase).toBe('clock');
    expect(flow(lost.log)).not.toContain('phase:main');

    // Contrast: declining to clock causes nothing and the Main Phase starts.
    const declined = act(s, cat, { type: 'CLOCK', player: 0, card: null });
    expect(declined.result).toBeNull();
    expect(declined.pending).toEqual(mainPlay(0));
  });

  it('[CLOCK-01][CLOCK-02] with an empty hand there is nothing to clock and no decision, but the closing check timing still runs before the Main Phase', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: [], stage: { 1: 'Y0' } }, { deck: deck(), hand: ['R0'] }],
      start: 'clock',
    });
    // The Draw Phase did not run (start: clock), so the hand really is empty here.
    expect(flow(phaseEvents(s.log, 'clock'))).toEqual(['phase:clock', 'trigger:clockPhaseStart', 'check', 'check']);
    expect(s.log.some((e) => e.kind === 'move' && (e.reason === 'clock' || e.reason === 'draw'))).toBe(false);
    expect(s.players[0].clock).toEqual([]);
    expect(s.phase).toBe('main');
    expect(s.pending).toEqual(mainPlay(0));
    // The opponent's hand is not a source for the turn player's clock.
    expect(s.players[1].clock).toEqual([]);
    expect(defsIn(s, 1, 'hand')).toEqual(['R0']);
  });

  it('[CLOCK-02] the turn player may clock at most one card from hand, or none: those are the only choices offered', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0', 'R0', 'B0'] }, { deck: deck(), hand: ['G0'] }], start: 'clock' });
    const hand = s.players[0].hand;
    const legal = legalActions(s, cat);
    expect(legal).toHaveLength(hand.length + 1);
    expect(legal.every((a) => a.type === 'CLOCK' && a.player === 0)).toBe(true);
    const choices = legal.map((a) => (a.type === 'CLOCK' ? a.card : 'other'));
    expect(choices).toContain(null);
    expect(choices.filter((c) => c !== null).sort()).toEqual([...hand].sort());

    // Not a card from anywhere but the turn player's own hand, and not the opponent's decision.
    expect(attempt(s, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'deck', 'G0') })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'CLOCK', player: 0, card: cardIn(s, 1, 'hand', 'G0') })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'CLOCK', player: 1, card: cardIn(s, 1, 'hand', 'G0') })).toBe('NOT_YOUR_DECISION');
  });

  it('[CLOCK-02] clocking a card draws exactly two cards (top first) with no further choice; declining puts nothing in the clock and draws nothing', () => {
    const s = makeState(cat, {
      players: [{ deck: ['G0', 'G0', 'G0', 'Y0', 'R0', 'B0'], hand: ['Y0', 'R0', 'B0'] }, { deck: deck() }],
      start: 'clock',
    });
    const card = cardIn(s, 0, 'hand', 'R0');
    const r = applyAction(s, cat, { type: 'CLOCK', player: 0, card });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.players[0].clock).toEqual([card]);
    // The two top cards, B0 then R0, are drawn; Y0 below them stays in the deck.
    expect(defsIn(r.state, 0, 'hand')).toEqual(['Y0', 'B0', 'B0', 'R0']);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['G0', 'G0', 'G0', 'Y0']);
    expect(moves(r.events).filter((m) => m.reason === 'draw')).toHaveLength(2);
    expect(r.state.pending).toEqual(mainPlay(0));

    const d = applyAction(s, cat, { type: 'CLOCK', player: 0, card: null });
    if (!d.ok) throw new Error(d.error.message);
    expect(d.state.players[0].clock).toEqual([]);
    expect(d.state.players[0].hand).toEqual(s.players[0].hand);
    expect(d.state.players[0].deck).toEqual(s.players[0].deck);
    expect(moves(d.events)).toEqual([]);
    expect(d.state.pending).toEqual(mainPlay(0));
  });
});

// --- 6.5 Main Phase ------------------------------------------------------------

describe('6.5 Main Phase', () => {
  it('[MAIN-01] the main-phase trigger is met, then exactly one check timing (the play timing\'s own) precedes the play timing', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck() }], start: 'main' });
    expect(flow(s.log)).toEqual(['phase:main', 'trigger:mainPhaseStart', 'check', 'playTiming:0:main']);
    expect(s.pending).toEqual(mainPlay(0));

    // Coming from the Clock Phase: the clock phase's closing check, then Main with its single check.
    const c = makeState(cat, { players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck() }], start: 'clock' });
    const r = applyAction(c, cat, { type: 'CLOCK', player: 0, card: null });
    if (!r.ok) throw new Error(r.error.message);
    expect(flow(phaseEvents(r.events, 'main'))).toEqual(['phase:main', 'trigger:mainPhaseStart', 'check', 'playTiming:0:main']);
  });

  it('[MAIN-01] main-phase actions can be taken in any order and any number of times within the one Main Phase', () => {
    let s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0', 'YE0', 'G0', 'YE0', 'R0'] }, { deck: deck() }], start: 'main' });
    const steps: Action[] = [
      { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'YE0', 0) },
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'Y0'), slot: 1 },
      { type: 'SWAP', player: 0, a: 1, b: 4 },
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'G0'), slot: 2 },
      { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'YE0', 1) },
      { type: 'SWAP', player: 0, a: 2, b: 4 },
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'R0'), slot: 3 },
      { type: 'SWAP', player: 0, a: 1, b: 3 },
    ];
    for (const step of steps) {
      s = act(s, cat, step);
      expect(s.phase).toBe('main');
      expect(s.pending).toEqual(mainPlay(0));
    }
    expect(stageDefs(s, 0)).toEqual([['R0'], ['Y0'], [], ['G0'], []]);
    expect(defsIn(s, 0, 'waiting')).toEqual(['YE0', 'YE0']);
    expect(flow(s.log).filter((t) => t === 'phase:main')).toHaveLength(1);
  });

  it('[MAIN-01] an action stays available only while its cost can still be paid', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['PC1', 'PC1', 'Y0'], stock: ['G0'] }, { deck: deck() }], start: 'main' });
    const first = cardIn(s, 0, 'hand', 'PC1', 0);
    const second = cardIn(s, 0, 'hand', 'PC1', 1);
    expect(attempt(s, { type: 'PLAY_CHARACTER', player: 0, card: second, slot: 2 })).toBe('ok');
    const after = act(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: first, slot: 1 });
    expect(after.players[0].stock).toEqual([]);
    expect(after.pending).toEqual(mainPlay(0));
    // The second copy costs 1 and the stock is empty now; the cost-0 card is still playable.
    expect(attempt(after, { type: 'PLAY_CHARACTER', player: 0, card: second, slot: 2 })).toBe('ILLEGAL_ACTION');
    expect(attempt(after, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(after, 0, 'hand', 'Y0'), slot: 2 })).toBe('ok');
  });

  it('[MAIN-02] a character from hand can go to any of the turn player\'s own five positions, and is placed in the one chosen', () => {
    const base = makeState(cat, {
      players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck(), hand: ['R0'], stage: { 2: 'B0' } }],
      start: 'main',
    });
    const y0 = cardIn(base, 0, 'hand', 'Y0');
    const offered = legalActions(base, cat).flatMap((a) => (a.type === 'PLAY_CHARACTER' && a.card === y0 ? [a.slot] : []));
    expect(offered.sort()).toEqual([1, 2, 3, 4, 5]);

    for (const slot of [1, 2, 3, 4, 5] as const) {
      const s = act(base, cat, { type: 'PLAY_CHARACTER', player: 0, card: y0, slot });
      expect(slotOf(s, y0)).toBe(slot);
      expect(locate(s, y0)?.player).toBe(0);
      expect(orientationOf(s, y0)).toBe('stand');
      expect(s.players[0].hand).toEqual([]);
      expect(stageDefs(s, 0).filter((cards) => cards.length > 0)).toEqual([['Y0']]);
      // The opponent's stage is untouched (their position 2 keeps B0).
      expect(stageDefs(s, 1)).toEqual([[], ['B0'], [], [], []]);
    }
    // Only the turn player may play characters in their Main Phase.
    expect(attempt(base, { type: 'PLAY_CHARACTER', player: 1, card: cardIn(base, 1, 'hand', 'R0'), slot: 1 })).toBe('NOT_YOUR_DECISION');
  });

  it('[MAIN-03] a played event goes from hand to the player\'s resolution zone, then to the waiting room once resolved', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['YE0', 'Y0'] }, { deck: deck() }], start: 'main' });
    const ev = cardIn(s, 0, 'hand', 'YE0');
    const r = applyAction(s, cat, { type: 'PLAY_EVENT', player: 0, card: ev });
    if (!r.ok) throw new Error(r.error.message);
    const path = moves(r.events).filter((m) => m.card === ev);
    expect(path.map((m) => [m.from, m.to])).toEqual([
      [{ player: 0, zone: 'hand' }, { player: 0, zone: 'resolution' }],
      [{ player: 0, zone: 'resolution' }, { player: 0, zone: 'waiting' }],
    ]);
    expect(r.state.players[0].resolution).toEqual([]);
    expect(r.state.players[0].waiting).toEqual([ev]);
    expect(r.state.pending).toEqual(mainPlay(0));
  });

  it("[MAIN-03] an event its player does not own resolves in that player's resolution zone but ends in its owner's waiting room", () => {
    const s0 = makeState(cat, { players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck(), hand: ['YE0'] }], start: 'main' });
    const borrowed = cardIn(s0, 1, 'hand', 'YE0'); // owned by player 1
    const s = ops.deepClone(s0);
    ops.moveCard(s, borrowed, { player: 0, zone: 'hand' }, 'effect');
    const r = applyAction(s, cat, { type: 'PLAY_EVENT', player: 0, card: borrowed });
    if (!r.ok) throw new Error(r.error.message);
    expect(moves(r.events).filter((m) => m.card === borrowed).map((m) => m.to)).toEqual([
      { player: 0, zone: 'resolution' },
      { player: 1, zone: 'waiting' },
    ]);
    expect(r.state.players[1].waiting).toEqual([borrowed]);
    expect(r.state.players[0].waiting).toEqual([]);
  });

  it('[MAIN-05] swapping two occupied positions moves both cards at the same time; each keeps its orientation and identity', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['G0'], stage: { 1: { def: 'Y0', orientation: 'rest' }, 4: 'R0' } }, { deck: deck(), stage: { 1: 'B0' } }],
      start: 'main',
    });
    const y0 = cardIn(s, 0, 'stage', 'Y0');
    const r0 = cardIn(s, 0, 'stage', 'R0');
    const r = applyAction(s, cat, { type: 'SWAP', player: 0, a: 1, b: 4 });
    if (!r.ok) throw new Error(r.error.message);
    expect(stageDefs(r.state, 0)).toEqual([['R0'], [], [], ['Y0'], []]);
    expect(orientationOf(r.state, y0)).toBe('rest');
    expect(orientationOf(r.state, r0)).toBe('stand');
    expect(r.state.cards[y0]?.epoch).toBe(s.cards[y0]?.epoch);
    // Both relocations are one simultaneous step: adjacent moves, nothing between them, and no rule action.
    expect(flow(r.events)).toEqual(['action:SWAP', 'move:swap', 'move:swap', 'check', 'playTiming:0:main']);
    expect(moves(r.events).map((m) => [m.card, m.from.slot, m.to.slot]).sort()).toEqual(
      [
        [y0, 1, 4],
        [r0, 4, 1],
      ].sort(),
    );
    // The swap is on the turn player's own stage only.
    expect(stageDefs(r.state, 1)).toEqual([['B0'], [], [], [], []]);
  });

  it('[MAIN-05] with one empty position, the card moves into it (in either direction)', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['G0'], stage: { 2: 'Y0' } }, { deck: deck() }], start: 'main' });
    expect(stageDefs(act(s, cat, { type: 'SWAP', player: 0, a: 2, b: 5 }), 0)).toEqual([[], [], [], [], ['Y0']]);
    expect(stageDefs(act(s, cat, { type: 'SWAP', player: 0, a: 1, b: 2 }), 0)).toEqual([['Y0'], [], [], [], []]);
  });

  it('[MAIN-05] choosing two empty positions changes nothing', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['G0'], stage: { 1: 'Y0' } }, { deck: deck() }], start: 'main' });
    const r = applyAction(s, cat, { type: 'SWAP', player: 0, a: 3, b: 4 });
    // Whether the engine treats it as a no-op action or does not offer it, no card may move.
    const after = r.ok ? r.state : s;
    if (r.ok) expect(moves(r.events)).toEqual([]);
    expect(stageDefs(after, 0)).toEqual(stageDefs(s, 0));
    expect(after.players[0].hand).toEqual(s.players[0].hand);
    expect(after.pending).toEqual(mainPlay(0));
  });

  it('[MAIN-05] a swap has no cost, so it can be repeated in the same play timing (swapping back restores the stage)', () => {
    const s = makeState(cat, { players: [{ deck: deck(), stage: { 1: 'Y0', 4: 'R0' } }, { deck: deck() }], start: 'main' });
    const once = act(s, cat, { type: 'SWAP', player: 0, a: 1, b: 4 });
    expect(attempt(once, { type: 'SWAP', player: 0, a: 1, b: 4 })).toBe('ok');
    const twice = act(once, cat, { type: 'SWAP', player: 0, a: 1, b: 4 });
    expect(stageDefs(twice, 0)).toEqual(stageDefs(s, 0));
    expect(twice.players[0].stage.flat().map((c) => c.id)).toEqual(s.players[0].stage.flat().map((c) => c.id));
    expect(twice.pending).toEqual(mainPlay(0));
  });

  it('[MAIN-06] choosing to do nothing ends the Main Phase and play moves to the Climax Phase; taking an action does not', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['YX'], clock: ['Y0'], stage: { 1: 'Y0' } }, { deck: deck() }], start: 'main' });
    const passed = applyAction(s, cat, { type: 'PASS', player: 0 });
    if (!passed.ok) throw new Error(passed.error.message);
    const t = flow(passed.events);
    expect(t.slice(0, 2)).toEqual(['action:PASS', 'phase:climax']);
    expect(t).not.toContain('playTiming:0:main');
    expect(passed.state.phase).toBe('climax');
    expect(passed.state.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });

    const swapped = act(s, cat, { type: 'SWAP', player: 0, a: 1, b: 2 });
    expect(swapped.phase).toBe('main');
    expect(swapped.pending).toEqual(mainPlay(0));
  });
});

// --- 6.6 Climax Phase ----------------------------------------------------------

describe('6.6 Climax Phase', () => {
  it('[CLIMAX-01] the climax-phase trigger and its own check timing come first, then the play timing with its check timing', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['YX'], clock: ['Y0'], stage: { 1: 'Z0' } }, { deck: deck() }],
      start: 'climax',
    });
    expect(flow(s.log)).toEqual([
      'phase:climax',
      'trigger:climaxPhaseStart',
      'check', // 6.6.1.1
      'ruleAction:insufficientPower',
      'move:ruleAction',
      'check', // the check timing that precedes the play timing
      'playTiming:0:climax',
    ]);
  });

  it('[CLIMAX-01] after the play timing a check timing is fully resolved (here: the older of two climaxes leaves) before the Attack Phase', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['YX'], clock: ['Y0'], climax: ['RX'] }, { deck: deck() }],
      start: 'climax',
    });
    const rx = cardIn(s, 0, 'climax', 'RX');
    const r = applyAction(s, cat, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s, 0, 'hand', 'YX') });
    if (!r.ok) throw new Error(r.error.message);
    const t = flow(r.events);
    expect(t.slice(0, t.indexOf('phase:attack') + 1)).toEqual([
      'action:PLAY_CLIMAX',
      'move:play',
      'check',
      'ruleAction:extraCards',
      'move:ruleAction',
      'phase:attack',
    ]);
    expect(moves(r.events).find((m) => m.reason === 'ruleAction')?.card).toBe(rx);

    // Passing instead: still a check timing, then the Attack Phase.
    const p = applyAction(s, cat, { type: 'PASS', player: 0 });
    if (!p.ok) throw new Error(p.error.message);
    expect(flow(p.events).slice(0, 3)).toEqual(['action:PASS', 'check', 'phase:attack']);
  });

  it('[CLIMAX-02] in the climax play timing the only cards the turn player may play are climaxes from their own hand', () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: ['Y0', 'YE0', 'YX', 'BX'], clock: ['Y0', 'B0'], stage: { 1: 'R0' } },
        { deck: deck(), hand: ['RX'], clock: ['R0'] },
      ],
      start: 'climax',
    });
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    const legal = legalActions(s, cat);
    expect(legal.filter((a) => a.type !== 'PASS').every((a) => a.type === 'PLAY_CLIMAX')).toBe(true);
    expect(legal.flatMap((a) => (a.type === 'PLAY_CLIMAX' ? [a.card] : [])).sort()).toEqual(
      [cardIn(s, 0, 'hand', 'YX'), cardIn(s, 0, 'hand', 'BX')].sort(),
    );
    expect(attempt(s, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'Y0'), slot: 2 })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'YE0') })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'SWAP', player: 0, a: 1, b: 2 })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s, 1, 'hand', 'RX') })).toBe('ILLEGAL_ACTION');

    // Contrast: in the Main Phase the same climaxes are not playable.
    const m = makeState(cat, { players: [{ deck: deck(), hand: ['YX', 'BX'], clock: ['Y0', 'B0'] }, { deck: deck() }], start: 'main' });
    expect(legalActions(m, cat).some((a) => a.type === 'PLAY_CLIMAX')).toBe(false);
  });

  it('[CLIMAX-02] a played climax goes into the turn player\'s climax area', () => {
    const s = makeState(cat, {
      // A big hand stops the turn at the End Phase hand-limit step, before the climax is cleaned up.
      players: [{ deck: deck(), hand: ['YX', ...many('G0', 9)], clock: ['Y0'] }, { deck: deck() }],
      start: 'climax',
    });
    const yx = cardIn(s, 0, 'hand', 'YX');
    const r = applyAction(s, cat, { type: 'PLAY_CLIMAX', player: 0, card: yx });
    if (!r.ok) throw new Error(r.error.message);
    expect(moves(r.events)[0]).toMatchObject({ card: yx, from: { player: 0, zone: 'hand' }, to: { player: 0, zone: 'climax' } });
    expect(r.state.pending?.kind).toBe('discard');
    expect(r.state.players[0].climax.map((c) => c.id)).toEqual([yx]);
    expect(r.state.players[0].hand).not.toContain(yx);
    expect(r.state.players[1].climax).toEqual([]);
  });

  it('[CLIMAX-03] after one action in the climax play timing there is no further play timing, so a second climax cannot be played', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['YX', 'RX', ...many('G0', 8)], clock: ['Y0', 'R0'] }, { deck: deck() }],
      start: 'climax',
    });
    const yx = cardIn(s, 0, 'hand', 'YX');
    const rx = cardIn(s, 0, 'hand', 'RX');
    expect(attempt(s, { type: 'PLAY_CLIMAX', player: 0, card: rx })).toBe('ok');
    const r = applyAction(s, cat, { type: 'PLAY_CLIMAX', player: 0, card: yx });
    if (!r.ok) throw new Error(r.error.message);
    expect(flow(r.events).filter((t) => t.startsWith('playTiming'))).toEqual([]);
    expect(flow(r.events)).toContain('phase:attack');
    expect(r.state.players[0].climax.map((c) => c.id)).toEqual([yx]);
    expect(r.state.players[0].hand).toContain(rx);
    expect(r.state.phase).toBe('end');
    expect(attempt(r.state, { type: 'PLAY_CLIMAX', player: 0, card: rx })).toBe('ILLEGAL_ACTION');
  });
});

// --- 6.8 End Phase -------------------------------------------------------------

describe('6.8 End Phase', () => {
  it('[END-01] the End Phase starts with the end-of-turn trigger, then a check timing, before the hand-limit step', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 9), stage: { 1: 'Z0' } }, { deck: deck() }], start: 'end' });
    expect(flow(s.log)).toEqual(['phase:end', 'trigger:turnEnd', 'check', 'ruleAction:insufficientPower', 'move:ruleAction']);
    expect(s.pending).toEqual({ kind: 'discard', player: 0, count: 2 });
  });

  it('[END-02] with more than 7 cards the turn player chooses exactly the excess and puts those into the waiting room', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['Y0', 'Y0b', 'R0', 'B0', 'G0', 'YE0', 'RC0', 'YX', 'BX'] }, { deck: deck(), hand: many('G0', 10) }],
      start: 'end',
    });
    expect(s.pending).toEqual({ kind: 'discard', player: 0, count: 2 });
    const hand = s.players[0].hand;
    const legal = legalActions(s, cat);
    expect(legal).toHaveLength(36); // every way to choose 2 of 9
    for (const a of legal) {
      expect(a.type).toBe('DISCARD');
      if (a.type === 'DISCARD') {
        expect(a.cards).toHaveLength(2);
        for (const c of a.cards) expect(hand).toContain(c);
      }
    }
    const [h0, h1, h2] = hand as [CardId, CardId, CardId];
    expect(attempt(s, { type: 'DISCARD', player: 0, cards: [h0] })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'DISCARD', player: 0, cards: [h0, h1, h2] })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'DISCARD', player: 0, cards: [h0, cardIn(s, 0, 'deck', 'G0')] })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'DISCARD', player: 1, cards: s.players[1].hand.slice(0, 2) })).toBe('NOT_YOUR_DECISION');

    const r0 = cardIn(s, 0, 'hand', 'R0');
    const yx = cardIn(s, 0, 'hand', 'YX');
    const r = applyAction(s, cat, { type: 'DISCARD', player: 0, cards: [r0, yx] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.players[0].hand).toHaveLength(7);
    expect([...r.state.players[0].waiting].sort()).toEqual([r0, yx].sort());
    // The non-turn player's oversized hand is never checked: no discard for them, and the turn passed.
    expect(moves(r.events).filter((m) => m.reason === 'handLimit').every((m) => m.from.player === 0)).toBe(true);
    expect(r.state.active).toBe(1);
    expect(r.state.players[1].hand).toHaveLength(11);
    expect(r.state.pending).toEqual({ kind: 'clock', player: 1 });
  });

  it('[END-02] contrast: exactly 7 cards needs no discard; 8 cards needs exactly one', () => {
    const seven = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 7) }, { deck: deck(), hand: ['R0'] }], start: 'end' });
    expect(seven.players[0].hand).toHaveLength(7);
    expect(moves(seven.log).filter((m) => m.reason === 'handLimit')).toEqual([]);
    expect(seven.active).toBe(1);

    const eight = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 8) }, { deck: deck() }], start: 'end' });
    expect(eight.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
  });

  it("[END-03] after the hand-limit step, the card in the turn player's climax area goes to the waiting room; the opponent's climax stays", () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: many('G0', 8), climax: ['YX'] },
        { deck: deck(), climax: ['RX'] },
      ],
      start: 'end',
    });
    const yx = cardIn(s, 0, 'climax', 'YX');
    // Still in place while the hand-limit discard is being decided.
    expect(s.pending).toEqual({ kind: 'discard', player: 0, count: 1 });
    expect(s.players[0].climax.map((c) => c.id)).toEqual([yx]);

    const discard = cardIn(s, 0, 'hand', 'G0');
    const r = applyAction(s, cat, { type: 'DISCARD', player: 0, cards: [discard] });
    if (!r.ok) throw new Error(r.error.message);
    const ms = moves(r.events);
    const discardAt = ms.findIndex((m) => m.card === discard && m.reason === 'handLimit');
    const cleanupAt = ms.findIndex((m) => m.card === yx);
    expect(discardAt).toBeGreaterThanOrEqual(0);
    expect(cleanupAt).toBeGreaterThan(discardAt);
    expect(ms[cleanupAt]).toMatchObject({ from: { player: 0, zone: 'climax' }, to: { player: 0, zone: 'waiting' } });
    expect(r.state.players[0].climax).toEqual([]);
    expect(r.state.players[0].waiting).toContain(yx);
    expect(defsIn(r.state, 1, 'waiting')).toEqual([]);
    expect(r.state.players[1].climax.map((c) => r.state.cards[c.id]?.def)).toEqual(['RX']);
  });

  it("[END-03] with no discard needed, the turn player's climax still goes to the waiting room after the (empty) hand-limit step and before the closing check timing", () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: many('G0', 7), climax: ['BX'] },
        { deck: deck(), climax: ['RX'] },
      ],
      start: 'end',
    });
    const seg = flow(phaseEvents(s.log, 'end'));
    expect(seg).toEqual(['phase:end', 'trigger:turnEnd', 'check', 'move:climaxCleanup', 'check']);
    const cleanup = moves(phaseEvents(s.log, 'end')).filter((m) => m.reason === 'climaxCleanup');
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]).toMatchObject({ from: { player: 0, zone: 'climax' }, to: { player: 0, zone: 'waiting' } });
    expect(defsIn(s, 0, 'waiting')).toEqual(['BX']);
    expect(s.players[1].climax.map((c) => s.cards[c.id]?.def)).toEqual(['RX']);
    expect(defsIn(s, 1, 'waiting')).toEqual([]);
  });

  it('[END-05] with the hand within the limit and nothing to resolve, the turn ends and the opponent starts from the Stand Phase', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 3), climax: ['YX'] }, { deck: deck() }], start: 'end' });
    const t = flow(s.log);
    expect(t.slice(0, t.indexOf('phase:stand') + 1)).toEqual([
      'phase:end',
      'trigger:turnEnd',
      'check',
      'move:climaxCleanup',
      'check',
      'turnStart:1',
      'phase:stand',
    ]);
    expect(s.active).toBe(1);
    expect(s.turn).toBe(3);
  });

  it('[END-05] a rule action in the first End Phase check timing does not restart the End Phase', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 3), stage: { 1: 'Z0' } }, { deck: deck() }], start: 'end' });
    const ends = s.log.filter((e) => e.kind === 'phase' && e.phase === 'end');
    expect(ends).toHaveLength(1);
    expect(flow(s.log)).toContain('ruleAction:insufficientPower');
    expect(s.active).toBe(1);
  });

  it('[END-05] a rule action in the closing (6.8.1.4) check timing sends play back to the start of the End Phase before the turn ends', () => {
    const s0 = makeState(cat, { players: [{ deck: [...deck(), 'Z0'], hand: many('G0', 9) }, { deck: deck() }], start: 'end' });
    expect(s0.pending).toEqual({ kind: 'discard', player: 0, count: 2 });
    // Stand-in for an effect (M3) that puts a power-0 character on stage after the first check timing.
    const s = ops.deepClone(s0);
    ops.moveCard(s, cardIn(s, 0, 'deck', 'Z0'), { player: 0, zone: 'stage', slot: 1 }, 'effect');
    const r = applyAction(s, cat, { type: 'DISCARD', player: 0, cards: s.players[0].hand.slice(0, 2) });
    if (!r.ok) throw new Error(r.error.message);
    const t = flow(r.events);
    expect(t.slice(0, t.indexOf('phase:stand') + 1)).toEqual([
      'action:DISCARD',
      'move:handLimit',
      'move:handLimit',
      'check',
      'ruleAction:insufficientPower',
      'move:ruleAction',
      'phase:end', // starts over from 6.8.1.1
      'trigger:turnEnd',
      'check',
      'check',
      'turnStart:1',
      'phase:stand',
    ]);
    expect(r.events.filter((e) => e.kind === 'phase' && e.phase === 'end' && e.turn === 2)).toHaveLength(1);
    expect(r.state.log.filter((e) => e.kind === 'phase' && e.phase === 'end' && e.turn === 2)).toHaveLength(2);
  });

  it('[END-05] a hand still over the limit at 6.8.1.5 sends play back to the start of the End Phase, which asks for the discard again', () => {
    const s0 = makeState(cat, { players: [{ deck: deck(), hand: many('G0', 9) }, { deck: deck() }], start: 'end' });
    // Stand-in for an effect (M3) that adds cards to the hand during the End Phase.
    const s = ops.deepClone(s0);
    for (let i = 0; i < 3; i++) ops.moveCard(s, s.players[0].deck[s.players[0].deck.length - 1] as CardId, { player: 0, zone: 'hand' }, 'effect');
    expect(s.players[0].hand).toHaveLength(12);
    const again = act(s, cat, { type: 'DISCARD', player: 0, cards: s.players[0].hand.slice(0, 2) });
    expect(again.active).toBe(0);
    expect(again.turn).toBe(2);
    expect(again.pending).toEqual({ kind: 'discard', player: 0, count: 3 });
    expect(again.log.filter((e) => e.kind === 'phase' && e.phase === 'end')).toHaveLength(2);
    expect(again.log.filter((e) => e.kind === 'trigger' && e.condition === 'turnEnd')).toHaveLength(2);

    const done = act(again, cat, { type: 'DISCARD', player: 0, cards: again.players[0].hand.slice(0, 3) });
    expect(done.players[0].hand).toHaveLength(7);
    expect(done.active).toBe(1);
  });
});

// --- 4.4 / 8.5.1 Check timing ---------------------------------------------------

describe('4.4 and 8.5.1 check timing', () => {
  it("[CONC-10][ABL-07] one check timing resolves every due rule action of both players before anything else happens", () => {
    const s = makeState(cat, {
      players: [
        { deck: deck(), hand: ['G0'], stage: { 1: 'Z0', 2: ['Y0', 'R0'] } },
        { deck: deck(), stage: { 3: 'YE0', 4: 'Z0', 5: 'B0' } },
      ],
      start: 'main',
    });
    const t = flow(s.log);
    const check = t.indexOf('check');
    const play = t.indexOf('playTiming:0:main');
    // Everything between the check timing and the play timing is rule actions.
    const inside = t.slice(check + 1, play);
    expect(inside.every((x) => x.startsWith('ruleAction:') || x === 'move:ruleAction')).toBe(true);
    expect(inside.filter((x) => x === 'move:ruleAction')).toHaveLength(4);
    expect(t.filter((x) => x === 'check')).toHaveLength(1);
    expect(stageDefs(s, 0)).toEqual([[], ['R0'], [], [], []]);
    expect(stageDefs(s, 1)).toEqual([[], [], [], [], ['B0']]);
    expect(defsIn(s, 0, 'waiting').sort()).toEqual(['Y0', 'Z0']);
    expect(defsIn(s, 1, 'waiting').sort()).toEqual(['YE0', 'Z0']);
  });

  it('[CONC-10] a loss found by the check timing ends the game before any play timing is given', () => {
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['Y0'], stage: { 1: 'Z0' } }, { deck: deck(), level: ['R0', 'R0', 'R0', 'R0'] }],
      start: 'main',
    });
    expect(s.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
    expect(flow(s.log)).not.toContain('playTiming:0:main');
    expect(s.pending).toBeNull();
  });

  it('[ABL-07] due rule actions are resolved all at once from one snapshot: an older character and a newer power-0 character in one position both leave', () => {
    // One at a time, "power 0" first would leave the older Y0 alone and keep it. Simultaneously,
    // Y0 is an extra card (not placed last) and Z0 has 0 power, so both go.
    const s = makeState(cat, {
      players: [{ deck: deck(), hand: ['G0'], stage: { 1: ['Y0', 'Z0'], 2: ['Z0', 'R0'], 3: ['B0', 'Y0b'] } }, { deck: deck() }],
      start: 'main',
    });
    expect(stageDefs(s, 0)).toEqual([[], ['R0'], ['Y0b'], [], []]);
    expect(defsIn(s, 0, 'waiting').sort()).toEqual(['B0', 'Y0', 'Z0', 'Z0']);
    expect(flow(s.log).filter((x) => x === 'check')).toHaveLength(1);
  });

  it('[ABL-07][CONC-10] at every play timing of random games, no check-type rule action is left unresolved', () => {
    let playTimings = 0;
    let ruleActions = 0;
    for (const seed of SEEDS) {
      const { states } = randomGame(seed);
      for (const s of states) {
        if (s.pending?.kind !== 'play') continue;
        playTimings++;
        for (const player of [0, 1] as const) {
          const p = s.players[player];
          expect(p.level.length).toBeLessThan(4);
          expect(p.deck.length + p.waiting.length).toBeGreaterThan(0);
          for (const cards of p.stage) {
            expect(cards.length).toBeLessThanOrEqual(1);
            for (const c of cards) {
              const def = catalog[s.cards[c.id]?.def ?? ''];
              expect(def?.kind).toBe('character');
              expect(def?.power ?? 0).toBeGreaterThan(0);
            }
          }
          expect(p.climax.length).toBeLessThanOrEqual(1);
          for (const c of p.climax) expect(catalog[s.cards[c.id]?.def ?? '']?.kind).toBe('climax');
        }
      }
      ruleActions += states[states.length - 1]?.log.filter((e) => e.kind === 'ruleAction').length ?? 0;
    }
    expect(playTimings).toBeGreaterThan(50);
    expect(ruleActions).toBeGreaterThan(0); // the walks really exercised rule actions
  });
});

// --- 4.5 / 8.5.2 Play timing -----------------------------------------------------

describe('4.5 and 8.5.2 play timing', () => {
  it('[CONC-11][ABL-09] after an action, the check timing removes what the action made illegal before the player gets the next play timing', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['Z0', 'Y0'], stage: { 2: 'R0' } }, { deck: deck() }], start: 'main' });
    const z0 = cardIn(s, 0, 'hand', 'Z0');
    const a = applyAction(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: z0, slot: 1 });
    if (!a.ok) throw new Error(a.error.message);
    expect(flow(a.events)).toEqual(['action:PLAY_CHARACTER', 'move:play', 'check', 'ruleAction:insufficientPower', 'move:ruleAction', 'playTiming:0:main']);
    expect(a.state.players[0].waiting).toEqual([z0]);

    // Playing onto an occupied position: the older character is gone before the play timing.
    const r0 = cardIn(s, 0, 'stage', 'R0');
    const b = applyAction(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'Y0'), slot: 2 });
    if (!b.ok) throw new Error(b.error.message);
    expect(flow(b.events)).toEqual(['action:PLAY_CHARACTER', 'move:play', 'check', 'ruleAction:extraCards', 'move:ruleAction', 'playTiming:0:main']);
    expect(b.state.players[0].waiting).toEqual([r0]);
    expect(stageDefs(b.state, 0)).toEqual([[], ['Y0'], [], [], []]);
  });

  it('[CONC-11][ABL-09] in random games, every play timing is immediately preceded by a check timing (only that check timing\'s rule actions in between)', () => {
    let seen = 0;
    for (const seed of SEEDS) {
      const { states } = randomGame(seed);
      const log = states[states.length - 1]?.log ?? [];
      log.forEach((e, i) => {
        if (e.kind !== 'playTiming') return;
        seen++;
        let j = i - 1;
        while (j >= 0) {
          const prev = log[j] as GameEvent;
          if (prev.kind === 'checkTiming') break;
          // A check timing holds rule actions and, after them, standby automatic abilities (CR 8.5.1.2):
          // in M2 that is Encore, with its yes/no answer and its cost.
          const allowed =
            prev.kind === 'ruleAction' ||
            prev.kind === 'auto' ||
            (prev.kind === 'move' && (prev.reason === 'ruleAction' || prev.reason === 'encore' || prev.reason === 'cost')) ||
            (prev.kind === 'action' && (prev.action.type === 'ACCEPT' || prev.action.type === 'PASS' || prev.action.type === 'ORDER_AUTO'));
          if (!allowed) throw new Error(`seed ${seed}: play timing at log ${i} is preceded by ${tag(prev)} with no check timing in between`);
          j--;
        }
        expect(j).toBeGreaterThanOrEqual(0);
      });
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('[CONC-12][ABL-09] after each main-phase action the same player gets another play timing; only the player with the play timing may act, one legal action at a time', () => {
    let s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0', 'YE0', 'G0'] }, { deck: deck(), hand: ['R0'] }], start: 'main' });
    const opts = legalActions(s, cat);
    expect(opts).toContainEqual({ type: 'PASS', player: 0 }); // doing nothing is always a choice
    // Actions not allowed at this moment are refused.
    expect(attempt(s, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') })).toBe('ILLEGAL_ACTION');
    expect(attempt(s, { type: 'PLAY_CHARACTER', player: 1, card: cardIn(s, 1, 'hand', 'R0'), slot: 1 })).toBe('NOT_YOUR_DECISION');
    expect(attempt(s, { type: 'PASS', player: 1 })).toBe('NOT_YOUR_DECISION');

    const steps: Action[] = [
      { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'Y0'), slot: 1 },
      { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'YE0') },
      { type: 'SWAP', player: 0, a: 1, b: 2 },
    ];
    for (const step of steps) {
      const r = applyAction(s, cat, step);
      if (!r.ok) throw new Error(r.error.message);
      const t = flow(r.events);
      // Exactly one new play timing, for the same player, after a check timing.
      expect(t.filter((x) => x.startsWith('playTiming'))).toEqual(['playTiming:0:main']);
      expect(t.slice(-2)).toEqual(['check', 'playTiming:0:main']);
      expect(r.state.pending).toEqual(mainPlay(0));
      s = r.state;
    }
  });

  it('[CONC-12][ABL-09] the climax play timing is the specified exception: after its one action no play timing is given again', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['YX', 'BX'], clock: ['Y0', 'B0'] }, { deck: deck() }], start: 'climax' });
    const r = applyAction(s, cat, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s, 0, 'hand', 'YX') });
    if (!r.ok) throw new Error(r.error.message);
    const t = flow(r.events);
    // No play timing of any kind for the turn player after the climax action: straight to check, then Attack.
    expect(t.filter((x) => x.startsWith('playTiming:0'))).toEqual([]);
    expect(t.slice(0, 4)).toEqual(['action:PLAY_CLIMAX', 'move:play', 'check', 'phase:attack']);
    // The other climax is still in hand but player 0 has no decision to use it with.
    expect(attempt(r.state, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s, 0, 'hand', 'BX') })).toBe('NOT_YOUR_DECISION');
    // Contrast: the main-phase rule (re-grant after an action) is what the climax window overrides.
    const m = makeState(cat, { players: [{ deck: deck(), hand: ['Y0'] }, { deck: deck() }], start: 'main' });
    const mr = applyAction(m, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(m, 0, 'hand', 'Y0'), slot: 1 });
    if (!mr.ok) throw new Error(mr.error.message);
    expect(flow(mr.events).filter((x) => x.startsWith('playTiming:0'))).toEqual(['playTiming:0:main']);
  });

  it('[CONC-12][CONC-13][ABL-09] in random games, a main-phase action gives the same player another play timing and passing advances the phase', () => {
    let regrants = 0;
    let mainPasses = 0;
    let climaxPasses = 0;
    for (const seed of SEEDS) {
      const { states, actions } = randomGame(seed);
      actions.forEach((action, i) => {
        const before = states[i] as GameState;
        const after = states[i + 1] as GameState;
        const pending = before.pending;
        if (pending?.kind !== 'play') return;
        const events = since(before, after);
        const firstPhase = events.find((e) => e.kind === 'phase');
        if (action.type === 'PASS' && pending.window === 'counter') {
          // The Counter Step's play timing ends and the Damage Step follows (M2).
          expect(events.some((e) => e.kind === 'step' && e.step === 'damage')).toBe(true);
        } else if (action.type === 'PASS') {
          // Doing nothing: no new play timing in this window; the game moves on to the next phase.
          expect(firstPhase && tag(firstPhase)).toBe(pending.window === 'main' ? 'phase:climax' : 'phase:attack');
          expect(events.some((e) => e.kind === 'playTiming' && e.window === pending.window && e.turn === before.turn)).toBe(false);
          if (pending.window === 'main') mainPasses++;
          else climaxPasses++;
        } else if (pending.window === 'main') {
          // The play timing comes back after its check timing; an Encore decision may come first inside it.
          if (after.pending?.kind === 'encore' || after.pending?.kind === 'autoOrder') expect(after.pending.player).toBe(pending.player);
          else expect(after.pending).toEqual(mainPlay(pending.player));
          expect(firstPhase).toBeUndefined();
          regrants++;
        }
      });
    }
    expect(regrants).toBeGreaterThan(10);
    expect(mainPasses).toBeGreaterThan(5);
    expect(climaxPasses).toBeGreaterThan(5);
  });

  it('[CONC-13][ABL-09] doing nothing ends the play timing and the game progresses: Main to Climax, Climax to Attack', () => {
    const s = makeState(cat, { players: [{ deck: deck(), hand: ['Y0', 'YX'], clock: ['Y0'] }, { deck: deck() }], start: 'main' });
    const main = applyAction(s, cat, { type: 'PASS', player: 0 });
    if (!main.ok) throw new Error(main.error.message);
    expect(flow(main.events)).toEqual(['action:PASS', 'phase:climax', 'trigger:climaxPhaseStart', 'check', 'check', 'playTiming:0:climax']);

    const climax = applyAction(main.state, cat, { type: 'PASS', player: 0 });
    if (!climax.ok) throw new Error(climax.error.message);
    const t = flow(climax.events);
    expect(t.slice(0, 3)).toEqual(['action:PASS', 'check', 'phase:attack']);
    expect(t.filter((x) => x.startsWith('playTiming:0'))).toEqual([]);
  });
});
