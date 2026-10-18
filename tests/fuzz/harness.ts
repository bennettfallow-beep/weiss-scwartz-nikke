// Seeded random-game fuzz harness (M2), shared by the per-deck fuzz files. A random bot plays complete games across every
// pairing of the fuzz decks. After every action it checks the invariants,
// that legal actions validate and illegal ones do not, that the events hide
// what each player may not see, and every so often that a JSON copy of the
// state plays on identically. After every game it checks that replaying the
// actions gives the same state. A game that does not finish within the action
// cap is a failure. Coverage counts show the rare branches really ran.
//
//   npm run test:fuzz                 2000 games in all (the milestone gate)
//   FUZZ_GAMES=300 npm run test:fuzz  the CI run
// Each file plays the pairings where one deck goes first, so the three files
// run in parallel.
import { expect, it } from 'vitest';

import {
  actor,
  applyAction,
  canSee,
  checkInvariants,
  createGame,
  HIDDEN,
  legalActions,
  nextInt,
  other,
  projectEvents,
  projectView,
  replay,
  seedRng,
  stateHash,
  validate,
} from '../../src/engine';
import type { Action, GameEvent, GameState, RngState } from '../../src/engine';
import { randomChoice } from '../../src/ai';
import { fuzzCatalog as catalog, fuzzDecks } from '../helpers/fuzz-decks';

const GAMES = Number(process.env.FUZZ_GAMES ?? 2000);
const MAX_ACTIONS = 5000;
const ROUND_TRIP_EVERY = 40;


export type Coverage = Map<string, number>;
const bump = (c: Coverage, key: string, n = 1) => c.set(key, (c.get(key) ?? 0) + n);


function tally(c: Coverage, events: readonly GameEvent[], before: GameState): void {
  let inDamage = before.damage !== null;
  for (const e of events) {
    bump(c, `event:${e.kind}`);
    if (e.kind === 'icon') bump(c, `icon:${e.icon}`);
    if (e.kind === 'attack') bump(c, `attack:${e.attack}`);
    if (e.kind === 'auto') bump(c, `auto:${e.ability}`);
    if (e.kind === 'battle' && e.reversed.length === 2) bump(c, 'battle:tie');
    if (e.kind === 'damage') inDamage = true;
    if (e.kind === 'damageCanceled' || e.kind === 'damageTaken') inDamage = false;
    if (e.kind === 'refresh' && inDamage) bump(c, 'refresh:duringDamage');
    if (e.kind === 'move' && e.reason === 'levelUp' && e.to.zone === 'level' && inDamage) bump(c, 'levelUp:duringDamage');
    if (e.kind === 'playTiming') bump(c, `playTiming:${e.window}`);
    if (e.kind === 'effect') bump(c, `op:${e.op}`);
    if (e.kind === 'ability') bump(c, `ability:${e.category}`);
    if (e.kind === 'optional') bump(c, `optional:${e.purpose}:${e.accepted ? 'yes' : 'no'}`);
    if (e.kind === 'action') bump(c, `action:${e.action.type}`);
    if (e.kind === 'gameOver') bump(c, e.result.kind === 'draw' ? 'result:draw' : `result:${e.result.reason}`);
  }
}

/** Every move into a zone the viewer cannot see must hide the card, and the opponent's hand is never shown. */
function hiddenInfoProblems(state: GameState, events: readonly GameEvent[]): string[] {
  const out: string[] = [];
  for (const viewer of [0, 1] as const) {
    for (const e of projectEvents(events, viewer)) {
      if (e.kind === 'move' && !canSee(viewer, e.to) && e.card !== HIDDEN) out.push(`viewer ${viewer} sees ${e.card} moving into ${e.to.zone}`);
      if (e.kind === 'look' && e.player !== viewer && e.cards.some((c) => c !== HIDDEN)) out.push(`viewer ${viewer} sees cards the opponent looks at`);
      if (e.kind === 'action' && e.action.type === 'CHOOSE_CARD' && e.action.player !== viewer && e.action.card !== HIDDEN) out.push(`viewer ${viewer} sees the opponent's pick`);
    }
    const view = projectView({ ...state, log: [] }, viewer);
    if (view.look && view.look.player !== viewer && view.look.cards !== null) out.push(`viewer ${viewer} sees the opponent's looked-at cards`);
    if (view.players[other(viewer)].hand !== null) out.push(`viewer ${viewer} sees the opponent's hand`);
    if (view.pending && view.pending.player !== viewer && !('redacted' in view.pending)) out.push(`viewer ${viewer} sees the opponent's decision`);
  }
  return out;
}

/** Legal actions validate; the same action from the other player, or with a made-up card, does not. */
function oracleProblems(state: GameState, legal: readonly Action[], rng: RngState): [string[], RngState] {
  const out: string[] = [];
  let r = rng;
  for (let k = 0; k < Math.min(3, legal.length); k++) {
    const [i, next] = nextInt(r, legal.length);
    r = next;
    const a = legal[i] as Action;
    const v = validate(state, catalog, a);
    if (!v.ok) out.push(`legal ${a.type} failed validation: ${v.error.code}`);
    const who = actor(state);
    if (who !== null && validate(state, catalog, { ...a, player: other(who) }).ok) out.push(`${a.type} accepted from the wrong player`);
    if ('card' in a && a.card !== null && validate(state, catalog, { ...a, card: 'p9-99' }).ok) out.push(`${a.type} accepted with an unknown card`);
  }
  return [out, r];
}

interface GameRun {
  violations: string[];
  actions: Action[];
  state: GameState;
}

export function playGame(seed: string, pairing: [number, number], coverage: Coverage): GameRun {
  const decks: [string[], string[]] = [[...(fuzzDecks[pairing[0]] ?? [])], [...(fuzzDecks[pairing[1]] ?? [])]];
  const created = createGame({ seed, decks }, catalog);
  if (!created.ok) return { violations: [`setup failed: ${JSON.stringify(created.errors)}`], actions: [], state: null as never };
  let state = created.state;
  let rng = seedRng(`bot-${seed}`);
  const actions: Action[] = [];
  const violations = checkInvariants(state, catalog);
  tally(coverage, state.log, state);
  for (let i = 0; !state.result && violations.length === 0; i++) {
    if (i >= MAX_ACTIONS) {
      violations.push(`no result after ${MAX_ACTIONS} actions (turn ${state.turn})`);
      break;
    }
    const legal = legalActions(state, catalog);
    if (legal.length === 0) {
      violations.push(`stuck at action ${i}: pending ${state.pending?.kind ?? 'none'} with no legal action`);
      break;
    }
    const [problems, r0] = oracleProblems(state, legal, rng);
    const [action, r1] = randomChoice(legal, r0);
    rng = r1;
    violations.push(...problems.map((p) => `action ${i}: ${p}`));
    const result = applyAction(state, catalog, action);
    if (!result.ok) {
      violations.push(`action ${i}: legal ${action.type} rejected: ${result.error.code}`);
      break;
    }
    // Also round-trip in the middle of an ability, where the most state is in flight.
    if ((i % ROUND_TRIP_EVERY === 0 || result.state.resolving !== null) && !result.state.result) {
      // A JSON copy must play on exactly like the original.
      const copy = JSON.parse(JSON.stringify(result.state)) as GameState;
      const next = legalActions(result.state, catalog)[0];
      if (next) {
        const a = applyAction(result.state, catalog, next);
        const b = applyAction(copy, catalog, next);
        if (!a.ok || !b.ok || stateHash(a.state) !== stateHash(b.state)) violations.push(`action ${i}: JSON copy of the state diverged`);
      }
    }
    tally(coverage, result.events, state);
    violations.push(...hiddenInfoProblems(result.state, result.events).map((p) => `action ${i}: ${p}`));
    violations.push(...checkInvariants(result.state, catalog).map((v) => `action ${i}: ${v}`));
    actions.push(action);
    state = result.state;
  }
  bump(coverage, 'games');
  bump(coverage, 'actions', actions.length);
  bump(coverage, 'turns', state.turn);
  return { violations, actions, state };
}

/** Registers the tests for every pairing where deck `first` is player 0's deck. */
export function fuzzFile(first: number): void {
  const pairings = fuzzDecks.map((_, b): [number, number] => [first, b]);
  const total = Math.ceil(GAMES / fuzzDecks.length);
  const coverage: Coverage = new Map();

  for (const [p, pairing] of pairings.entries()) {
    const games = Math.floor(total / pairings.length) + (p < total % pairings.length ? 1 : 0);
    it(`decks ${pairing[0]} vs ${pairing[1]}: ${games} games finish with no violation and replay identically`, () => {
      const failures: string[] = [];
      for (let g = 0; g < games; g++) {
        const seed = `fuzz-${pairing[0]}${pairing[1]}-${g}`;
        const run = playGame(seed, pairing, coverage);
        if (run.violations.length > 0) {
          failures.push(`${seed}: ${run.violations.slice(0, 3).join(' | ')}`);
          continue;
        }
        const again = replay({ seed, decks: [[...(fuzzDecks[pairing[0]] ?? [])], [...(fuzzDecks[pairing[1]] ?? [])]] }, catalog, run.actions);
        if (!again.ok || stateHash(again.state) !== stateHash(run.state)) failures.push(`${seed}: replay differs`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('reached every combat branch', () => {
    // Common branches must show up in any run; the rest need enough games to be reached reliably.
    const always = ['attack:direct', 'attack:frontal', 'attack:side', 'event:damageCanceled', 'event:damageTaken', 'event:battle', 'auto:encore', 'playTiming:counter', 'event:effectsExpired', 'result:level4'];
    const withVolume = [
      ...['soul', 'return', 'pool', 'comeback', 'draw', 'shot', 'treasure', 'gate', 'standby', 'choice'].map((i) => `icon:${i}`),
      'battle:tie',
      'auto:shot',
      'event:backup',
      'action:ORDER_ICON',
      'action:CHOOSE_SLOT',
      'action:CHOOSE_DEST',
      'refresh:duringDamage',
      // Card abilities (M3): every step of the language and every way into it.
      ...['choose', 'draw', 'discard', 'stockFromDeck', 'heal', 'power', 'soul', 'damageOpp', 'salvage', 'lookTop', 'sendToWaiting', 'returnToHand', 'may', 'if'].map((o) => `op:${o}`),
      'ability:activated',
      'ability:automatic',
      'action:ACTIVATE',
      'event:look',
      'event:deckArranged',
      'event:chosen',
      'optional:payCost:yes',
      'optional:payCost:no',
      'optional:may:yes',
      'optional:may:no',
      'optional:drawMore:yes',
      'optional:lookMore:yes',
    ];
    const rare = ['action:ORDER_AUTO', 'levelUp:duringDamage'];
    const must = [...always, ...(total >= 100 ? withVolume : []), ...(total >= 600 ? rare : [])];
    const sorted = [...coverage.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    console.log(`fuzz coverage, deck ${first} first, ${coverage.get('games') ?? 0} games:\n${sorted.map(([k, n]) => `  ${k}: ${n}`).join('\n')}`);
    expect(must.filter((k) => !coverage.get(k))).toEqual([]);
  });
}
