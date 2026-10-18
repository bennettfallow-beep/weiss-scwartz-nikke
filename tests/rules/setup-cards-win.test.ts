// Rule tests for M1: player count and golden rules (GEN), winning and losing
// (WIN), card information (CARD), deck construction (DECK) and game setup
// (SETUP). Every title starts with the rules-matrix id(s) it covers.
import { describe, expect, it } from 'vitest';

import {
  applyAction,
  costOf,
  createGame,
  legalActions,
  levelOf,
  other,
  powerOf,
  projectView,
  soulOf,
  validate,
  validateDeck,
} from '../../src/engine';
import type { Action, CardCatalog, CardDef, GameEvent, GameSetup, GameState, PlayerId } from '../../src/engine';
import { act, cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ZoneSpec } from '../../src/engine/testkit';
import { catalog, legalDeck } from '../helpers/catalog';

// --- synthetic cards used only here (original names) -------------------------

const cat: CardCatalog = {
  ...catalog,
  // Level 0 character with a cost of 2 (for stock payment).
  YC2: { id: 'YC2', name: 'Yellow Engineer', kind: 'character', color: 'yellow', level: 0, cost: 2, power: 3000, soul: 1 },
  // Level 1 counter event (for ordinary level/color rules on counters).
  RC1: { id: 'RC1', name: 'Red Riposte', kind: 'event', color: 'red', level: 1, cost: 1, counter: true },
  // Same name as Y0 "Yellow Scout" but a different type, color and everything else.
  TWIN: { id: 'TWIN', name: 'Yellow Scout', kind: 'event', color: 'blue', level: 0, cost: 0 },
  // Same information as Y0 but a different name.
  Y0N: { id: 'Y0N', name: 'Yellow Scout Mk II', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 2000, soul: 1 },
};

// --- helpers -------------------------------------------------------------------

const DECKS: GameSetup['decks'] = [legalDeck('yellow'), legalDeck('red')];
const FILL = ['Y0', 'Y0', 'Y0', 'Y0', 'Y0', 'Y0'];
const FILLERS = Object.keys(catalog).filter((id) => id.startsWith('F-'));

function newGame(seed: string, decks: GameSetup['decks'] = DECKS): GameState {
  const r = createGame({ seed, decks }, catalog);
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r.errors)}`);
  return r.state;
}

/** A seed whose random starting player is `p` (found by trying seeds in order). */
function seedStartingWith(p: PlayerId): string {
  for (let i = 0; i < 200; i++) {
    const seed = `start-${i}`;
    if (newGame(seed).starting === p) return seed;
  }
  throw new Error(`no seed found where player ${p} starts`);
}

/** `extras` first, then filler characters (4 per name) up to `size` cards. */
function deckWith(extras: readonly string[], size = 50): string[] {
  const out = [...extras];
  for (const id of FILLERS) for (let k = 0; k < 4 && out.length < size; k++) out.push(id);
  if (out.length < size) throw new Error('not enough filler');
  return out;
}

function apply(s: GameState, c: CardCatalog, action: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(s, c, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return r;
}

function eventsOf<K extends GameEvent['kind']>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

/** Action types legal right now for one card in hand. */
function playsFor(s: GameState, c: CardCatalog, card: string): string[] {
  return [...new Set(legalActions(s, c).filter((a) => 'card' in a && a.card === card).map((a) => a.type))];
}

function codes(errors: readonly { code: string }[]): string[] {
  return errors.map((e) => e.code);
}

/** createGame error codes for a catalog with extra (possibly malformed) definitions. */
function catalogErrors(extra: Record<string, unknown>): string[] {
  const r = createGame({ seed: 'catalog', decks: DECKS }, { ...catalog, ...extra } as unknown as CardCatalog);
  return r.ok ? [] : codes(r.errors);
}

/** The events that order a resolution: level placement, draws, check timings, rule actions, game over. */
function milestones(events: readonly GameEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.kind === 'move' && e.to.zone === 'level') return ['level'];
    if (e.kind === 'move' && e.reason === 'draw') return ['draw'];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}`];
    if (e.kind === 'gameOver') return ['gameOver'];
    return [];
  });
}

const SEVEN = ['Y0', 'Y0b', 'Y1', 'Y2', 'R0', 'R1', 'B0'];

// =============================================================================
// GEN: player count and golden rules
// =============================================================================

describe('GEN: player count and golden rules', () => {
  it('[GEN-01] a game is set up for exactly two players; one, three or no decks are rejected', () => {
    const two = createGame({ seed: 'gen01', decks: DECKS }, catalog);
    expect(two.ok).toBe(true);
    if (two.ok) expect(two.state.players).toHaveLength(2);

    const d = legalDeck('yellow');
    for (const decks of [[d], [d, d, d], []]) {
      const r = createGame({ seed: 'gen01', decks } as unknown as GameSetup, catalog);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(codes(r.errors)).toEqual(['TWO_PLAYERS']);
    }
  });

  it('[GEN-01] there is no third seat: an action for any player other than 0 or 1 is rejected, even a concession', () => {
    const s = newGame('gen01b');
    for (const player of [2, -1, 3]) {
      for (const action of [
        { type: 'CONCEDE', player },
        { type: 'MULLIGAN', player, discard: [] },
      ]) {
        const v = validate(s, catalog, action as unknown as Action);
        expect(v).toMatchObject({ ok: false, error: { code: 'BAD_PLAYER' } });
        expect(applyAction(s, catalog, action as unknown as Action).ok).toBe(false);
      }
    }
  });

  it('[GEN-04] the clock draw of two with one card left draws that card and skips the impossible second draw', () => {
    const s = makeState(catalog, { players: [{ deck: ['Y1'], hand: ['Y0'] }, { deck: FILL }], start: 'clock' });
    expect(s.pending).toEqual({ kind: 'clock', player: 0 });
    const r = apply(s, catalog, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') });

    // As much as possible: exactly one draw happened, nothing else stood in for the second one.
    expect(eventsOf(r.events, 'move').filter((e) => e.reason === 'draw')).toHaveLength(1);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['Y1']);
    expect(defsIn(r.state, 0, 'clock')).toEqual(['Y0']);
    expect(r.state.players[0].deck).toEqual([]);
    expect(r.state.players[0].waiting).toEqual([]);
    // The (later) check timing then judges the empty deck and waiting room.
    expect(r.state.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
  });

  it('[GEN-04] contrast: with two cards left the same clock draw performs both draws', () => {
    const s = makeState(catalog, { players: [{ deck: ['Y1', 'Y2', 'R1'], hand: ['Y0'] }, { deck: FILL }], start: 'clock' });
    const r = apply(s, catalog, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'Y0') });
    expect(eventsOf(r.events, 'move').filter((e) => e.reason === 'draw')).toHaveLength(2);
    expect(r.state.players[0].hand).toHaveLength(2);
    expect(r.state.result).toBeNull();
  });

  it('[GEN-05] standing all characters does not re-stand one that is already standing; only rested and reversed ones change', () => {
    const s = makeState(catalog, {
      players: [
        {
          deck: FILL,
          hand: ['B0'],
          stage: { 1: { def: 'Y1', orientation: 'rest' }, 2: 'Y0', 3: { def: 'R0', orientation: 'reverse' } },
        },
        { deck: FILL },
      ],
      start: 'stand',
    });
    const rested = cardIn(s, 0, 'stage', 'Y1');
    const standing = cardIn(s, 0, 'stage', 'Y0');
    const reversed = cardIn(s, 0, 'stage', 'R0');

    const changed = eventsOf(s.log, 'orientation');
    expect(changed.map((e) => e.card).sort()).toEqual([rested, reversed].sort());
    expect(changed.every((e) => e.orientation === 'stand')).toBe(true);
    expect(changed.some((e) => e.card === standing)).toBe(false);
    expect(s.players[0].stage.flat().map((c) => c.orientation)).toEqual(['stand', 'stand', 'stand']);
  });

  it('[GEN-06] a mulligan of zero cards draws zero cards: hand, deck and waiting room are untouched', () => {
    const s = newGame('gen06');
    const p = s.starting;
    const before = ops.deepClone(s.players[p]);
    const r = apply(s, catalog, { type: 'MULLIGAN', player: p, discard: [] });
    expect(eventsOf(r.events, 'move')).toEqual([]);
    expect(r.state.players[p].hand).toEqual(before.hand);
    expect(r.state.players[p].deck).toEqual(before.deck);
    expect(r.state.players[p].waiting).toEqual(before.waiting);
  });

  it('[GEN-06] drawing zero or a negative number of cards does nothing, and never puts a card back into the deck', () => {
    // Negative counts only arise from card effects (M3), so this drives the draw primitive directly.
    const base = makeState(catalog, {
      players: [{ deck: ['Y0', 'Y1', 'Y2'], hand: ['R0', 'R1'] }, { deck: FILL }],
      start: 'mulligan',
    });
    expect(base.pending).toEqual({ kind: 'mulligan', player: 0 });
    const drawN = (n: number): GameState => {
      const s = ops.deepClone(base);
      s.pending = null;
      ops.queueDraws(s, 0, n);
      ops.run(s, catalog);
      return s;
    };
    for (const n of [0, -1, -3]) {
      const s = drawN(n);
      expect(s.players[0].hand, `draw ${n}`).toEqual(base.players[0].hand);
      expect(s.players[0].deck, `draw ${n}`).toEqual(base.players[0].deck);
      expect(eventsOf(s.log.slice(base.log.length), 'move'), `draw ${n}`).toEqual([]);
    }
    const two = drawN(2);
    expect(defsIn(two, 0, 'hand')).toEqual(['R0', 'R1', 'Y2', 'Y1']);
    expect(defsIn(two, 0, 'deck')).toEqual(['Y0']);
  });

  it('[GEN-06] the end-phase discard down to the hand limit is not done when the count is zero or negative (no draw instead)', () => {
    const end = (hand: string[]) =>
      makeState(catalog, { players: [{ deck: ['Y2', 'Y2', 'Y2'], hand }, { deck: FILL }], start: 'end' });

    // Exactly 7 cards: discard 0. Only 3 cards: discard -4, which must not become "draw 4".
    for (const hand of [[...FILL, 'Y1'], ['Y1', 'R1', 'B1']]) {
      const s = end(hand);
      const label = `hand of ${hand.length}`;
      expect(eventsOf(s.log, 'move').filter((e) => e.card.startsWith('p0-')), label).toEqual([]);
      expect(defsIn(s, 0, 'hand'), label).toEqual(hand);
      expect(defsIn(s, 0, 'deck'), label).toEqual(['Y2', 'Y2', 'Y2']);
      expect(s.players[0].waiting, label).toEqual([]);
      // No discard decision was ever asked for: the turn passed straight to player 1.
      expect(s.active, label).toBe(1);
      expect(s.pending, label).toEqual({ kind: 'clock', player: 1 });
    }

    // Contrast: 8 cards means one discard is required.
    const over = end([...FILL, 'Y1', 'Y1']);
    expect(over.pending).toEqual({ kind: 'discard', player: 0, count: 1, picked: [] });
  });

  it('[GEN-08] when both players must level up at once, the turn player decides first and the other decides after seeing that choice', () => {
    for (const active of [0, 1] as const) {
      const non = other(active);
      const zones = (): ZoneSpec => ({ deck: FILL, clock: SEVEN });
      const s = makeState(catalog, { players: [zones(), zones()], active, start: 'main' });

      expect(s.pending, `turn player ${active}`).toMatchObject({ kind: 'levelUp', player: active });
      const early = validate(s, catalog, { type: 'LEVEL_UP', player: non, card: cardIn(s, non, 'clock', 'Y2') });
      expect(early).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_DECISION' } });

      const chosen = cardIn(s, active, 'clock', 'Y2');
      const after = act(s, catalog, { type: 'LEVEL_UP', player: active, card: chosen });
      expect(after.pending).toMatchObject({ kind: 'levelUp', player: non });
      // The non-turn player's view already shows the turn player's choice.
      const view = projectView(after, non);
      expect(view.players[active].level.map((c) => c.id)).toEqual([chosen]);
      expect(view.pending).toMatchObject({ kind: 'levelUp', player: non });
      expect(view.pending).not.toHaveProperty('redacted');
    }
  });
});

// =============================================================================
// WIN: winning, losing, draws, conceding
// =============================================================================

describe('WIN: winning, losing, draws, conceding', () => {
  it('[WIN-01] when the non-turn player loses, the game ends at once and the turn player wins', () => {
    const s = makeState(catalog, {
      players: [{ deck: FILL, hand: ['Y0'] }, { deck: FILL, level: ['R0', 'R0', 'R0', 'R0'] }],
      start: 'main',
    });
    expect(s.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
    expect(s.phase).toBe('gameOver');
    expect(s.pending).toBeNull();
    expect(s.tasks).toEqual([]);
    expect(s.log.at(-1)?.kind).toBe('gameOver');
    // Nothing after the loss: the main phase play timing never opened.
    expect(eventsOf(s.log, 'playTiming')).toEqual([]);
    expect(legalActions(s, catalog)).toEqual([]);
    for (const a of [
      { type: 'PASS', player: 0 },
      { type: 'CONCEDE', player: 1 },
      { type: 'CONCEDE', player: 0 },
    ] as Action[]) {
      expect(validate(s, catalog, a)).toMatchObject({ ok: false, error: { code: 'GAME_OVER' } });
    }
  });

  it('[WIN-01] when the turn player loses, the opponent wins and the turn goes no further', () => {
    let s = makeState(catalog, {
      players: [{ deck: FILL, hand: ['R1'], level: ['Y0', 'Y0', 'Y0'], clock: SEVEN.slice(0, 6) }, { deck: FILL }],
      start: 'clock',
    });
    s = act(s, catalog, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'R1') });
    const r = apply(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y0') });
    expect(r.state.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
    expect(r.state.pending).toBeNull();
    expect(r.events.at(-1)?.kind).toBe('gameOver');
    expect(eventsOf(r.events, 'phase').map((e) => e.phase)).not.toContain('main');
  });

  it('[WIN-02] reaching level 4 mid-action does not end the game on the spot: the clock draw finishes, then the check timing judges the loss', () => {
    let s = makeState(catalog, {
      players: [{ deck: FILL, hand: ['R1'], level: ['Y0', 'Y0', 'Y0'], clock: SEVEN.slice(0, 6) }, { deck: FILL }],
      start: 'clock',
    });
    s = act(s, catalog, { type: 'CLOCK', player: 0, card: cardIn(s, 0, 'hand', 'R1') });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    const r = apply(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y0') });

    expect(milestones(r.events)).toEqual(['level', 'draw', 'draw', 'check', 'rule:loss', 'gameOver']);
    expect(r.state.players[0].hand).toHaveLength(2);
    expect(r.state.result).toMatchObject({ kind: 'win', loser: 0, reason: 'level4' });
  });

  it('[WIN-02] a player already at level 4 is still asked for their next level-up choice; the loss comes at the next check timing', () => {
    let s = makeState(catalog, {
      players: [{ deck: FILL, level: ['Y0', 'Y0', 'Y0'], clock: [...SEVEN, ...SEVEN] }, { deck: FILL }],
      start: 'main',
    });
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });
    s = act(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y0') });

    // Losing condition met, but no rule-action check has happened yet.
    expect(s.players[0].level).toHaveLength(4);
    expect(s.result).toBeNull();
    expect(s.pending).toMatchObject({ kind: 'levelUp', player: 0 });

    const r = apply(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y0') });
    expect(milestones(r.events)).toEqual(['level', 'check', 'rule:loss', 'gameOver']);
    expect(r.state.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
  });

  it('[WIN-03] three level cards is not a losing condition; four or more is, for either player', () => {
    const at = (level0: number, level1: number): GameState =>
      makeState(catalog, {
        players: [
          { deck: FILL, hand: ['Y0'], level: Array<string>(level0).fill('Y0') },
          { deck: FILL, level: Array<string>(level1).fill('R0') },
        ],
        start: 'main',
      });
    const safe = at(3, 3);
    expect(safe.result).toBeNull();
    expect(safe.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    expect(at(0, 4).result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
    expect(at(4, 0).result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'level4' });
    expect(at(1, 5).result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'level4' });
  });

  it('[WIN-04] no cards in deck and no cards in waiting room is a losing condition', () => {
    const s = makeState(catalog, {
      players: [{ deck: FILL, hand: ['Y0'] }, { deck: [], waiting: [], hand: ['R0'], stage: { 1: 'R0' } }],
      start: 'main',
    });
    expect(s.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'deckOut' });
    const t = makeState(catalog, { players: [{ deck: [], waiting: [], hand: ['Y0'] }, { deck: FILL }], start: 'main' });
    expect(t.result).toEqual({ kind: 'win', winner: 1, loser: 0, reason: 'deckOut' });
  });

  it('[WIN-04] an empty deck alone is not a loss: the waiting room is refreshed into the deck instead', () => {
    const s = makeState(catalog, { players: [{ deck: FILL, hand: ['Y0'] }, { deck: [], waiting: ['R0', 'R1', 'R0'] }], start: 'main' });
    expect(s.result).toBeNull();
    expect(eventsOf(s.log, 'refresh').map((e) => e.player)).toEqual([1]);
    expect(s.players[1].deck).toHaveLength(2);
    expect(s.players[1].clock).toHaveLength(1);
    expect(s.players[1].waiting).toEqual([]);
  });

  it('[WIN-04] an empty waiting room alone is not a loss', () => {
    const s = makeState(catalog, { players: [{ deck: FILL, hand: ['Y0'] }, { deck: ['R0'], waiting: [] }], start: 'main' });
    expect(s.result).toBeNull();
    expect(s.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
  });

  it('[WIN-05] both players judged as losing in the same check timing is a draw, whatever their reasons', () => {
    const both = makeState(catalog, {
      players: [
        { deck: FILL, level: ['Y0', 'Y0', 'Y0', 'Y0'] },
        { deck: FILL, level: ['R0', 'R0', 'R0', 'R0'] },
      ],
      start: 'main',
    });
    expect(both.result).toEqual({ kind: 'draw', reasons: ['level4', 'level4'] });
    expect(both.phase).toBe('gameOver');
    expect(legalActions(both, catalog)).toEqual([]);

    const mixed = makeState(catalog, {
      players: [{ deck: FILL, level: ['Y0', 'Y0', 'Y0', 'Y0'] }, { deck: [], waiting: [], hand: ['R0'] }],
      start: 'main',
    });
    expect(mixed.result).toEqual({ kind: 'draw', reasons: ['level4', 'deckOut'] });
  });

  it('[WIN-05] two level-ups that each reach level 4 before the same check timing make a draw, not a win', () => {
    const zones = (): ZoneSpec => ({ deck: FILL, level: ['Y0', 'Y0', 'Y0'], clock: SEVEN });
    let s = makeState(catalog, { players: [zones(), zones()], start: 'main' });
    s = act(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y1') });
    expect(s.result).toBeNull();
    s = act(s, catalog, { type: 'LEVEL_UP', player: 1, card: cardIn(s, 1, 'clock', 'Y1') });
    expect(s.result).toEqual({ kind: 'draw', reasons: ['level4', 'level4'] });
    expect(eventsOf(s.log, 'gameOver')).toHaveLength(1);
  });

  it('[WIN-06] either player may concede at any decision, even one that is not theirs; they lose at once with no check timing', () => {
    const scenarios: [string, GameState][] = [
      ['mulligan', newGame('win06')],
      ['clock', makeState(catalog, { players: [{ deck: FILL, hand: ['Y0'] }, { deck: FILL }], start: 'clock' })],
      ['main play', makeState(catalog, { players: [{ deck: FILL, hand: ['Y0'] }, { deck: FILL }], start: 'main' })],
      ['climax play', makeState(catalog, { players: [{ deck: FILL, hand: ['YX'] }, { deck: FILL }], start: 'climax' })],
      ['level up', makeState(catalog, { players: [{ deck: FILL, clock: SEVEN }, { deck: FILL }], start: 'main' })],
      ['interrupt order', makeState(catalog, { players: [{ deck: [], waiting: ['Y0', 'Y0'], clock: SEVEN }, { deck: FILL }], start: 'main' })],
      ['hand-limit discard', makeState(catalog, { players: [{ deck: FILL, hand: [...FILL, 'Y1', 'Y1', 'Y1'] }, { deck: FILL }], start: 'end' })],
    ];
    const kinds = new Set<string>();
    for (const [name, s] of scenarios) {
      expect(s.pending, name).not.toBeNull();
      kinds.add(s.pending?.kind ?? 'none');
      for (const player of [0, 1] as const) {
        const r = apply(s, catalog, { type: 'CONCEDE', player });
        expect(r.state.result, `${name}, player ${player}`).toEqual({ kind: 'win', winner: other(player), loser: player, reason: 'concede' });
        expect(r.state.phase).toBe('gameOver');
        expect(r.state.pending).toBeNull();
        expect(r.events.map((e) => e.kind), `${name}, player ${player}`).toEqual(['action', 'gameOver']);
      }
    }
    expect([...kinds].sort()).toEqual(['clock', 'discard', 'interruptOrder', 'levelUp', 'mulligan', 'play']);
  });

  it('[WIN-06] conceding skips the check timing, so an opponent who meets a losing condition but has not been judged yet wins', () => {
    let s = makeState(catalog, {
      players: [{ deck: FILL, level: ['Y0', 'Y0', 'Y0'], clock: [...SEVEN, ...SEVEN] }, { deck: FILL }],
      start: 'main',
    });
    s = act(s, catalog, { type: 'LEVEL_UP', player: 0, card: cardIn(s, 0, 'clock', 'Y0') });
    expect(s.players[0].level).toHaveLength(4); // player 0 meets a losing condition, not yet judged
    const r = apply(s, catalog, { type: 'CONCEDE', player: 1 });
    expect(r.state.result).toEqual({ kind: 'win', winner: 0, loser: 1, reason: 'concede' });
    expect(eventsOf(r.events, 'checkTiming')).toEqual([]);
  });
});

// =============================================================================
// CARD: card information
// =============================================================================

describe('CARD: card information', () => {
  it('[CARD-01][DECK-02] cards are grouped by card name: two prints of "Yellow Scout" with different power share the 4-copy limit', () => {
    expect(catalog.Y0?.name).toBe(catalog.Y0b?.name);
    expect(catalog.Y0?.power).not.toBe(catalog.Y0b?.power);
    const deck = deckWith(['Y0', 'Y0', 'Y0', 'Y0b', 'Y0b']);
    const errors = validateDeck(deck, catalog);
    expect(codes(errors)).toEqual(['DECK_COPIES']);
    expect(errors[0]?.message).toContain('Yellow Scout');
  });

  it('[CARD-01] the name alone identifies a card: same name with another type and color still counts; a different name does not', () => {
    expect(codes(validateDeck(deckWith(['Y0', 'Y0', 'Y0', 'TWIN', 'TWIN']), cat))).toEqual(['DECK_COPIES']);
    // Y0N matches Y0 in every respect except its name, so 4 + 4 is legal.
    expect(validateDeck(deckWith(['Y0', 'Y0', 'Y0', 'Y0', 'Y0N', 'Y0N', 'Y0N', 'Y0N']), cat)).toEqual([]);
  });

  it('[CARD-01] every card definition must carry a name', () => {
    const base = { kind: 'character', color: 'yellow', level: 0, cost: 0, power: 1000, soul: 1 };
    expect(catalogErrors({ NN1: { ...base, id: 'NN1', name: '' } })).toContain('CATALOG_NAME');
    expect(catalogErrors({ NN2: { ...base, id: 'NN2', name: '   ' } })).toContain('CATALOG_NAME');
    expect(catalogErrors({ NN3: { ...base, id: 'NN3' } })).toContain('CATALOG_NAME');
    expect(catalogErrors({ OK1: { ...base, id: 'OK1', name: 'Quiet Lantern' } })).toEqual([]);
  });

  it('[CARD-06] a card definition must be a character, an event or a climax; any other type is rejected before a game starts', () => {
    expect(catalogErrors({})).toEqual([]);
    for (const kind of ['stage', 'Character', 'counter', undefined]) {
      expect(catalogErrors({ K: { id: 'K', name: 'Odd Relic', kind, color: 'red', level: 0, cost: 0 } }), String(kind)).toContain('CATALOG_KIND');
    }
    const kinds = new Set(Object.values(catalog).map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['character', 'climax', 'event']);
  });

  it('[CARD-06] each type is played its own way: characters to a stage position, events as events, climaxes only in the climax phase', () => {
    const spec = (start: 'main' | 'climax') =>
      makeState(catalog, { players: [{ deck: FILL, hand: ['Y0', 'YE0', 'YX'], clock: ['Y0'] }, { deck: FILL }], start });
    const main = spec('main');
    expect(playsFor(main, catalog, cardIn(main, 0, 'hand', 'Y0'))).toEqual(['PLAY_CHARACTER']);
    expect(playsFor(main, catalog, cardIn(main, 0, 'hand', 'YE0'))).toEqual(['PLAY_EVENT']);
    expect(playsFor(main, catalog, cardIn(main, 0, 'hand', 'YX'))).toEqual([]);

    const climax = spec('climax');
    expect(playsFor(climax, catalog, cardIn(climax, 0, 'hand', 'Y0'))).toEqual([]);
    expect(playsFor(climax, catalog, cardIn(climax, 0, 'hand', 'YE0'))).toEqual([]);
    expect(playsFor(climax, catalog, cardIn(climax, 0, 'hand', 'YX'))).toEqual(['PLAY_CLIMAX']);
  });

  it('[CARD-09] a level 1 card can be played only when its color is among the cards in its player\'s level or clock', () => {
    const at = (level: string[], clock: string[]) =>
      makeState(catalog, { players: [{ deck: FILL, hand: ['Y1', 'R1'], level, clock, stock: ['B0'] }, { deck: FILL }], start: 'main' });

    const redOnly = at(['R0'], []);
    const y1 = cardIn(redOnly, 0, 'hand', 'Y1');
    expect(playsFor(redOnly, catalog, y1)).toEqual([]);
    expect(validate(redOnly, catalog, { type: 'PLAY_CHARACTER', player: 0, card: y1, slot: 1 })).toMatchObject({
      ok: false,
      error: { code: 'ILLEGAL_ACTION' },
    });
    expect(playsFor(redOnly, catalog, cardIn(redOnly, 0, 'hand', 'R1'))).toEqual(['PLAY_CHARACTER']);

    const yellowInClock = at(['R0'], ['Y0']);
    expect(playsFor(yellowInClock, catalog, cardIn(yellowInClock, 0, 'hand', 'Y1'))).toEqual(['PLAY_CHARACTER']);

    const yellowInLevel = at(['Y0'], []);
    expect(playsFor(yellowInLevel, catalog, cardIn(yellowInLevel, 0, 'hand', 'Y1'))).toEqual(['PLAY_CHARACTER']);
    expect(playsFor(yellowInLevel, catalog, cardIn(yellowInLevel, 0, 'hand', 'R1'))).toEqual([]);
  });

  it('[CARD-09] level 0 characters and events ignore color, but a climax always needs its color in level or clock', () => {
    const main = makeState(catalog, { players: [{ deck: FILL, hand: ['Y0', 'YE0'] }, { deck: FILL }], start: 'main' });
    expect(playsFor(main, catalog, cardIn(main, 0, 'hand', 'Y0'))).toEqual(['PLAY_CHARACTER']);
    expect(playsFor(main, catalog, cardIn(main, 0, 'hand', 'YE0'))).toEqual(['PLAY_EVENT']);

    const climax = makeState(catalog, { players: [{ deck: FILL, hand: ['YX', 'RX'], clock: ['R0'] }, { deck: FILL }], start: 'climax' });
    expect(playsFor(climax, catalog, cardIn(climax, 0, 'hand', 'RX'))).toEqual(['PLAY_CLIMAX']);
    expect(playsFor(climax, catalog, cardIn(climax, 0, 'hand', 'YX'))).toEqual([]);
  });

  it('[CARD-09] only the player\'s own level and clock count for color: stage, stock, waiting room, memory and the opponent do not', () => {
    const s = makeState(catalog, {
      players: [
        {
          deck: FILL,
          hand: ['Y1', 'YE1'],
          level: ['R0'],
          clock: ['R0'],
          stock: ['Y0', 'Y0'],
          waiting: ['Y0'],
          memory: ['Y0'],
          stage: { 4: 'Y0' },
        },
        { deck: FILL, level: ['Y0'], clock: ['Y0'] },
      ],
      start: 'main',
    });
    // Level 1 is met (one level card) and the cost is affordable; only color is missing.
    expect(playsFor(s, catalog, cardIn(s, 0, 'hand', 'Y1'))).toEqual([]);
    // A level 1 event is held to the same color requirement as a character.
    expect(playsFor(s, catalog, cardIn(s, 0, 'hand', 'YE1'))).toEqual([]);

    const fixed = makeState(catalog, {
      players: [{ deck: FILL, hand: ['Y1', 'YE1'], level: ['R0'], clock: ['Y0'], stock: ['Y0', 'Y0'] }, { deck: FILL }],
      start: 'main',
    });
    expect(playsFor(fixed, catalog, cardIn(fixed, 0, 'hand', 'Y1'))).toEqual(['PLAY_CHARACTER']);
    expect(playsFor(fixed, catalog, cardIn(fixed, 0, 'hand', 'YE1'))).toEqual(['PLAY_EVENT']);
  });

  it('[CARD-09] every card definition must have one of the game\'s colors', () => {
    const base = { name: 'Dim Lantern', kind: 'character', level: 0, cost: 0, power: 1000, soul: 1 };
    expect(catalogErrors({ C1: { ...base, id: 'C1', color: 'purple' } })).toContain('CATALOG_COLOR');
    expect(catalogErrors({ C2: { ...base, id: 'C2' } })).toContain('CATALOG_COLOR');
    for (const color of ['yellow', 'green', 'red', 'blue']) expect(catalogErrors({ C3: { ...base, id: 'C3', color } })).toEqual([]);
  });

  it('[CARD-11] a card\'s level is the minimum number of level cards its player needs to play it', () => {
    const at = (levels: number) =>
      makeState(catalog, {
        players: [{ deck: FILL, hand: ['Y1', 'Y2', 'YE1'], level: Array<string>(levels).fill('Y0'), stock: ['B0', 'B0'] }, { deck: FILL }],
        start: 'main',
      });
    const playable = (s: GameState) => ['Y1', 'Y2', 'YE1'].filter((d) => playsFor(s, catalog, cardIn(s, 0, 'hand', d)).length > 0);
    expect(playable(at(0))).toEqual([]);
    expect(playable(at(1))).toEqual(['Y1', 'YE1']);
    expect(playable(at(2))).toEqual(['Y1', 'Y2', 'YE1']);
  });

  it('[CARD-11] the player\'s level is the count of their own level zone: clock cards and the opponent\'s level do not count', () => {
    const s = makeState(catalog, {
      players: [
        { deck: FILL, hand: ['Y1', 'Y2'], level: ['Y0'], clock: ['Y0', 'Y0', 'Y0'], stock: ['B0', 'B0'] },
        { deck: FILL, level: ['R0', 'R0', 'R0'] },
      ],
      start: 'main',
    });
    expect(playsFor(s, catalog, cardIn(s, 0, 'hand', 'Y1'))).toEqual(['PLAY_CHARACTER']);
    expect(playsFor(s, catalog, cardIn(s, 0, 'hand', 'Y2'))).toEqual([]);
  });

  it('[CARD-11] only characters and events carry a level: a climax with one, or a character or event without one, is rejected', () => {
    expect(catalogErrors({ X1: { id: 'X1', name: 'Pale Noon', kind: 'climax', color: 'red', level: 0 } })).toContain('CATALOG_FIELD');
    expect(catalogErrors({ X2: { id: 'X2', name: 'Stray Knight', kind: 'character', color: 'red', cost: 0, power: 1000, soul: 1 } })).toContain(
      'CATALOG_MISSING',
    );
    expect(catalogErrors({ X3: { id: 'X3', name: 'Lost Flare', kind: 'event', color: 'red', cost: 0 } })).toContain('CATALOG_MISSING');
  });

  it('[CARD-11] a climax has no level, so it is playable with no cards in the level zone', () => {
    const s = makeState(catalog, { players: [{ deck: FILL, hand: ['YX'], clock: ['Y0'], level: [] }, { deck: FILL }], start: 'climax' });
    expect(playsFor(s, catalog, cardIn(s, 0, 'hand', 'YX'))).toEqual(['PLAY_CLIMAX']);
  });

  it('[CARD-12] playing a character moves as many cards as its cost from stock to the waiting room; a cost of 0 moves none', () => {
    const s = makeState(cat, { players: [{ deck: FILL, hand: ['YC2', 'Y0'], stock: ['R0', 'R1', 'B0'] }, { deck: FILL }], start: 'main' });
    const stock = [...s.players[0].stock];
    const r = apply(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'YC2'), slot: 1 });
    expect(r.state.players[0].stock).toEqual(stock.slice(0, 1));
    expect([...r.state.players[0].waiting].sort()).toEqual(stock.slice(1).sort());
    const paid = eventsOf(r.events, 'move').filter((e) => e.reason === 'cost');
    expect(paid.map((e) => [e.from.zone, e.to.zone])).toEqual([
      ['stock', 'waiting'],
      ['stock', 'waiting'],
    ]);

    const r2 = apply(r.state, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(r.state, 0, 'hand', 'Y0'), slot: 2 });
    expect(r2.state.players[0].stock).toEqual(stock.slice(0, 1));
    expect(eventsOf(r2.events, 'move').filter((e) => e.reason === 'cost')).toEqual([]);
  });

  it('[CARD-12] a card whose cost is more than the stock cannot be played; there is no partial payment', () => {
    const short = makeState(cat, { players: [{ deck: FILL, hand: ['YC2'], stock: ['R0'] }, { deck: FILL }], start: 'main' });
    const card = cardIn(short, 0, 'hand', 'YC2');
    expect(playsFor(short, cat, card)).toEqual([]);
    expect(validate(short, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 1 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_ACTION' } });

    const enough = makeState(cat, { players: [{ deck: FILL, hand: ['YC2'], stock: ['R0', 'R0'] }, { deck: FILL }], start: 'main' });
    expect(playsFor(enough, cat, cardIn(enough, 0, 'hand', 'YC2'))).toEqual(['PLAY_CHARACTER']);
  });

  it('[CARD-12] the cost can be paid only from stock: cards in the waiting room, clock or the opponent\'s stock do not help', () => {
    const s = makeState(cat, {
      players: [
        { deck: FILL, hand: ['YC2'], stock: ['R0'], waiting: ['R0', 'R0', 'R0'], clock: ['R0', 'R0'] },
        { deck: FILL, stock: ['B0', 'B0', 'B0'] },
      ],
      start: 'main',
    });
    const card = cardIn(s, 0, 'hand', 'YC2');
    expect(playsFor(s, cat, card)).toEqual([]);
    expect(validate(s, cat, { type: 'PLAY_CHARACTER', player: 0, card, slot: 2 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_ACTION' } });
  });

  it('[CARD-12] an event\'s cost is paid from stock in the same way', () => {
    const s = makeState(catalog, { players: [{ deck: FILL, hand: ['YE1'], level: ['Y0'], stock: ['B0', 'R0'] }, { deck: FILL }], start: 'main' });
    const top = s.players[0].stock[1];
    const ev = cardIn(s, 0, 'hand', 'YE1');
    const r = apply(s, catalog, { type: 'PLAY_EVENT', player: 0, card: ev });
    expect(defsIn(r.state, 0, 'stock')).toEqual(['B0']);
    expect(r.state.players[0].waiting).toContain(top);
    expect(r.state.players[0].waiting).toContain(ev);
  });

  it('[CARD-12] only characters and events carry a cost: a climax with one, or a character or event without one, is rejected', () => {
    expect(catalogErrors({ X1: { id: 'X1', name: 'Pale Noon', kind: 'climax', color: 'red', cost: 1 } })).toContain('CATALOG_FIELD');
    expect(catalogErrors({ X2: { id: 'X2', name: 'Stray Knight', kind: 'character', color: 'red', level: 0, power: 1000, soul: 1 } })).toContain(
      'CATALOG_MISSING',
    );
    expect(catalogErrors({ X3: { id: 'X3', name: 'Lost Flare', kind: 'event', color: 'red', level: 0 } })).toContain('CATALOG_MISSING');
  });

  it('[CARD-12][CARD-21] a climax has no cost, so playing it takes nothing from stock', () => {
    const s = makeState(catalog, { players: [{ deck: FILL, hand: ['YX'], clock: ['Y0'], stock: ['B0', 'B0'] }, { deck: FILL }], start: 'climax' });
    const stock = [...s.players[0].stock];
    const r = apply(s, catalog, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s, 0, 'hand', 'YX') });
    expect(r.state.players[0].stock).toEqual(stock);
    expect(eventsOf(r.events, 'move').filter((e) => e.reason === 'cost')).toEqual([]);
  });

  it('[CARD-14] a counter event can be played in its owner\'s main phase, under the ordinary cost rule', () => {
    const paid = makeState(catalog, { players: [{ deck: FILL, hand: ['RC0'], stock: ['B0'] }, { deck: FILL }], start: 'main' });
    const card = cardIn(paid, 0, 'hand', 'RC0');
    expect(catalog.RC0?.counter).toBe(true);
    expect(playsFor(paid, catalog, card)).toEqual(['PLAY_EVENT']);
    const r = apply(paid, catalog, { type: 'PLAY_EVENT', player: 0, card });
    expect(r.state.players[0].stock).toEqual([]);
    expect(r.state.players[0].waiting).toContain(card);

    const broke = makeState(catalog, { players: [{ deck: FILL, hand: ['RC0'], stock: [] }, { deck: FILL }], start: 'main' });
    expect(playsFor(broke, catalog, cardIn(broke, 0, 'hand', 'RC0'))).toEqual([]);
  });

  it('[CARD-14] a level 1 counter event in the main phase still needs the level and the color', () => {
    const at = (level: string[]) =>
      makeState(cat, { players: [{ deck: FILL, hand: ['RC1'], level, stock: ['B0'] }, { deck: FILL }], start: 'main' });
    const noLevel = at([]);
    expect(playsFor(noLevel, cat, cardIn(noLevel, 0, 'hand', 'RC1'))).toEqual([]);
    const wrongColor = at(['Y0']);
    expect(playsFor(wrongColor, cat, cardIn(wrongColor, 0, 'hand', 'RC1'))).toEqual([]);
    const ok = at(['R0']);
    expect(playsFor(ok, cat, cardIn(ok, 0, 'hand', 'RC1'))).toEqual(['PLAY_EVENT']);
  });

  it('[CARD-21] numeric information a card does not have reads as 0', () => {
    const climax = catalog.YX as CardDef;
    const event = catalog.YE0 as CardDef;
    expect([climax.level, climax.cost, climax.power, climax.soul]).toEqual([undefined, undefined, undefined, undefined]);
    expect([levelOf(climax), costOf(climax), powerOf(climax), soulOf(climax)]).toEqual([0, 0, 0, 0]);
    expect([event.power, event.soul]).toEqual([undefined, undefined]);
    expect([powerOf(event), soulOf(event)]).toEqual([0, 0]);
    // Information the card has is read as printed, including a printed 0.
    const scout = catalog.Y0 as CardDef;
    expect([levelOf(scout), costOf(scout), powerOf(scout), soulOf(scout)]).toEqual([0, 0, 2000, 1]);
    expect(powerOf(catalog.Z0 as CardDef)).toBe(0);
  });
});

// =============================================================================
// DECK: deck construction
// =============================================================================

describe('DECK: deck construction', () => {
  it('[DECK-01] a deck must contain exactly 50 cards', () => {
    expect(validateDeck(deckWith([], 50), catalog)).toEqual([]);
    expect(codes(validateDeck(deckWith([], 49), catalog))).toEqual(['DECK_SIZE']);
    expect(codes(validateDeck(deckWith([], 51), catalog))).toEqual(['DECK_SIZE']);
    expect(codes(validateDeck([], catalog))).toEqual(['DECK_SIZE']);
  });

  it('[DECK-01] each player brings their own deck: decks are checked separately and each player owns exactly the cards of their deck', () => {
    const bad = createGame({ seed: 'deck01', decks: [legalDeck('yellow'), deckWith([], 49)] }, catalog);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => [e.player, e.code])).toEqual([[1, 'DECK_SIZE']]);

    const s = newGame('deck01');
    for (const p of [0, 1] as const) {
      const ids = [...s.players[p].deck, ...s.players[p].hand];
      expect(ids.every((id) => s.cards[id]?.owner === p)).toBe(true);
      expect(ids.map((id) => s.cards[id]?.def).sort()).toEqual([...(DECKS[p] ?? [])].sort());
    }
  });

  it('[DECK-02] up to 4 copies of one card name is legal; a fifth copy is not', () => {
    expect(validateDeck(deckWith(['Y0', 'Y0', 'Y0', 'Y0']), catalog)).toEqual([]);
    const five = validateDeck(deckWith(['Y0', 'Y0', 'Y0', 'Y0', 'Y0']), catalog);
    expect(codes(five)).toEqual(['DECK_COPIES']);
  });

  it('[DECK-02] cards that share a name count toward one limit even when every other detail differs', () => {
    expect(codes(validateDeck(deckWith(['Y0', 'Y0b', 'TWIN', 'Y0b', 'TWIN']), cat))).toEqual(['DECK_COPIES']);
    expect(validateDeck(deckWith(['Y0', 'Y0b', 'TWIN', 'Y0b']), cat)).toEqual([]);
  });

  it('[DECK-03] a deck may hold 8 climax cards but not 9; fewer, even none, is fine', () => {
    expect(validateDeck(deckWith(['YX', 'YX', 'YX', 'YX', 'BX', 'BX', 'BX', 'BX']), catalog)).toEqual([]);
    expect(codes(validateDeck(deckWith(['YX', 'YX', 'YX', 'YX', 'BX', 'BX', 'BX', 'BX', 'RX']), catalog))).toEqual(['DECK_CLIMAX']);
    expect(validateDeck(deckWith([]), catalog)).toEqual([]);
  });

  it('[DECK-03] climax cards also obey the 4-per-name limit', () => {
    expect(codes(validateDeck(deckWith(['YX', 'YX', 'YX', 'YX', 'YX']), catalog))).toEqual(['DECK_COPIES']);
  });
});

// =============================================================================
// SETUP: game preparation
// =============================================================================

describe('SETUP: game preparation', () => {
  it('[SETUP-01] the game does not start unless both decks satisfy deck construction', () => {
    expect(createGame({ seed: 'setup01', decks: DECKS }, catalog).ok).toBe(true);

    const cases: [GameSetup['decks'], [PlayerId, string][]][] = [
      [[deckWith([], 49), legalDeck('red')], [[0, 'DECK_SIZE']]],
      [[legalDeck('yellow'), deckWith(['R0', 'R0', 'R0', 'R0', 'R0'])], [[1, 'DECK_COPIES']]],
      [
        [deckWith(['YX', 'YX', 'YX', 'YX', 'BX', 'BX', 'BX', 'BX', 'RX']), deckWith(['NOPE'], 50)],
        [
          [0, 'DECK_CLIMAX'],
          [1, 'DECK_UNKNOWN_CARD'],
        ],
      ],
    ];
    for (const [decks, expected] of cases) {
      const r = createGame({ seed: 'setup01', decks }, catalog);
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty('state');
      if (!r.ok) expect(r.errors.map((e) => [e.player, e.code])).toEqual(expected);
    }
  });

  it('[SETUP-02] each deck is shuffled into a random order before the opening hands are drawn', () => {
    const s = newGame('setup02');
    for (const p of [0, 1] as const) {
      const ids = [...s.players[p].deck, ...[...s.players[p].hand].reverse()];
      const listed = Array.from({ length: 50 }, (_, i) => `p${p}-${String(i).padStart(2, '0')}`);
      expect([...ids].sort()).toEqual(listed); // the same 50 cards...
      expect(ids).not.toEqual(listed); // ...but not in the order they were listed
    }
    const shuffles = eventsOf(s.log, 'shuffle');
    const firstDraw = eventsOf(s.log, 'move').find((e) => e.reason === 'draw');
    expect(shuffles.map((e) => e.player).sort()).toEqual([0, 1]);
    expect(firstDraw).toBeDefined();
    expect(shuffles.every((e) => e.seq < (firstDraw?.seq ?? 0))).toBe(true);

    // Different seeds give different orders.
    const tops = new Set(Array.from({ length: 30 }, (_, i) => newGame(`setup02-${i}`).players[0].deck.at(-1)));
    expect(tops.size).toBeGreaterThan(10);
  });

  it('[SETUP-02] the deck is face down: neither player can see which card is where in any deck', () => {
    const s = newGame('setup02b');
    for (const viewer of [0, 1] as const) {
      const view = projectView(s, viewer);
      const text = JSON.stringify(view);
      for (const p of [0, 1] as const) {
        expect(view.players[p].counts.deck).toBe(45);
        expect(view.players[p]).not.toHaveProperty('deck');
        for (const id of s.players[p].deck) expect(text).not.toContain(`"${id}"`);
      }
    }
  });

  it('[SETUP-03] the starting player is chosen at random: over many seeds each player starts a fair share of games', () => {
    const counts = [0, 0];
    for (let i = 0; i < 60; i++) {
      const s = newGame(`setup03-${i}`);
      counts[s.starting] = (counts[s.starting] ?? 0) + 1;
      expect(eventsOf(s.log, 'setup').map((e) => e.starting)).toEqual([s.starting]);
    }
    expect(counts[0]).toBeGreaterThanOrEqual(15);
    expect(counts[1]).toBeGreaterThanOrEqual(15);
  });

  it('[SETUP-03] nobody chooses the starting player: setup offers no such choice and ignores any request for one', () => {
    for (const p of [0, 1] as const) {
      const seed = seedStartingWith(p);
      const s = newGame(seed);
      // The first decision is the chosen player's mulligan; nothing lets them pick first or second.
      expect(s.pending).toEqual({ kind: 'mulligan', player: p });
      expect(legalActions(s, catalog).every((a) => a.type === 'MULLIGAN')).toBe(true);
      expect(validate(s, catalog, { type: 'CHOOSE_FIRST', player: p, first: other(p) } as unknown as Action).ok).toBe(false);
      // Asking for the other player in the setup changes nothing.
      const asked = createGame({ seed, decks: DECKS, starting: other(p) } as unknown as GameSetup, catalog);
      expect(asked.ok && asked.state.starting).toBe(p);
    }
  });

  it('[SETUP-04] each player draws 5 cards from their own deck as their opening hand', () => {
    const s = newGame('setup04');
    expect(s.pending?.kind).toBe('mulligan');
    expect(s.turn).toBe(0);
    for (const p of [0, 1] as const) {
      expect(s.players[p].hand).toHaveLength(5);
      expect(s.players[p].deck).toHaveLength(45);
      const draws = eventsOf(s.log, 'move').filter((e) => e.reason === 'draw' && e.to.player === p);
      expect(draws).toHaveLength(5);
      expect(draws.every((e) => e.from.zone === 'deck' && e.from.player === p && e.to.zone === 'hand')).toBe(true);
      expect(draws.map((e) => e.card).sort()).toEqual([...s.players[p].hand].sort());
    }
    expect(eventsOf(s.log, 'move').every((e) => e.reason === 'draw')).toBe(true);
  });

  it('[SETUP-05] the starting player decides their mulligan first, then the other player', () => {
    for (const p of [0, 1] as const) {
      const s = newGame(seedStartingWith(p));
      expect(s.pending).toEqual({ kind: 'mulligan', player: p });
      expect(validate(s, catalog, { type: 'MULLIGAN', player: other(p), discard: [] })).toMatchObject({
        ok: false,
        error: { code: 'NOT_YOUR_DECISION' },
      });
      const next = act(s, catalog, { type: 'MULLIGAN', player: p, discard: [] });
      expect(next.pending).toEqual({ kind: 'mulligan', player: other(p) });
    }
  });

  it('[SETUP-05] a mulligan puts the chosen cards into the waiting room, not the deck, then draws as many', () => {
    const s = newGame('setup05');
    const p = s.starting;
    const hand = [...s.players[p].hand];
    const discard = hand.slice(0, 2);
    const kept = hand.slice(2);
    const deckBefore = [...s.players[p].deck];
    const r = apply(s, catalog, { type: 'MULLIGAN', player: p, discard });

    const ps = r.state.players[p];
    expect([...ps.waiting].sort()).toEqual([...discard].sort());
    expect(ps.hand).toHaveLength(5);
    expect(ps.hand).toEqual(expect.arrayContaining(kept));
    expect(ps.deck).toHaveLength(43);
    expect(ps.deck.some((id) => discard.includes(id))).toBe(false);
    const drawn = ps.hand.filter((id) => !kept.includes(id));
    expect(drawn.every((id) => deckBefore.includes(id))).toBe(true);

    // Discard first, then draw.
    const moves = eventsOf(r.events, 'move').map((e) => `${e.from.zone}->${e.to.zone}`);
    expect(moves).toEqual(['hand->waiting', 'hand->waiting', 'deck->hand', 'deck->hand']);
  });

  it('[SETUP-05] any number of cards may be chosen, from none to the whole hand', () => {
    const s = newGame('setup05b');
    const p = s.starting;
    const options = legalActions(s, catalog);
    expect(options).toHaveLength(32); // every subset of a 5-card hand
    const sizes = options.map((a) => (a.type === 'MULLIGAN' ? a.discard.length : -1));
    expect(Math.min(...sizes)).toBe(0);
    expect(Math.max(...sizes)).toBe(5);

    const all = [...s.players[p].hand];
    const r = apply(s, catalog, { type: 'MULLIGAN', player: p, discard: all });
    expect([...r.state.players[p].waiting].sort()).toEqual([...all].sort());
    expect(r.state.players[p].hand).toHaveLength(5);
    expect(r.state.players[p].hand.some((id) => all.includes(id))).toBe(false);
  });

  it('[SETUP-05] the mulligan takes cards from the player\'s own hand only: deck cards and opponent cards are rejected', () => {
    const s = newGame('setup05d');
    const p = s.starting;
    const own = s.players[p].hand[0] ?? '';
    for (const discard of [[s.players[p].deck.at(-1) ?? ''], [s.players[other(p)].hand[0] ?? ''], [own, own]]) {
      expect(validate(s, catalog, { type: 'MULLIGAN', player: p, discard }), discard.join()).toMatchObject({
        ok: false,
        error: { code: 'ILLEGAL_ACTION' },
      });
    }
    expect(validate(s, catalog, { type: 'MULLIGAN', player: p, discard: [own] }).ok).toBe(true);
  });

  it('[SETUP-05] each player may mulligan only once', () => {
    const s = newGame('setup05c');
    const p = s.starting;
    const once = act(s, catalog, { type: 'MULLIGAN', player: p, discard: [s.players[p].hand[0] ?? ''] });
    expect(validate(once, catalog, { type: 'MULLIGAN', player: p, discard: [] }).ok).toBe(false);

    const both = act(once, catalog, { type: 'MULLIGAN', player: other(p), discard: [] });
    for (const q of [0, 1] as const) {
      expect(validate(both, catalog, { type: 'MULLIGAN', player: q, discard: [] }).ok).toBe(false);
    }
    expect(both.pending?.kind).not.toBe('mulligan');
  });

  it('[SETUP-06] the starting player is the turn player of the first turn', () => {
    for (const p of [0, 1] as const) {
      let s = newGame(seedStartingWith(p));
      s = act(s, catalog, { type: 'MULLIGAN', player: p, discard: [] }, { type: 'MULLIGAN', player: other(p), discard: [] });
      expect(s.turn).toBe(1);
      expect(s.active).toBe(p);
      expect(eventsOf(s.log, 'turnStart').map((e) => e.player)).toEqual([p]);
      expect(s.pending).toEqual({ kind: 'clock', player: p });
    }
  });
});
