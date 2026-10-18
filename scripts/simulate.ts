// Plays computer players against each other on the SYN decks and reports win
// rates and decision times (M4).
//
//   npm run simulate                                  the gate: 504 games, heuristic vs random
//   npm run simulate -- --games 180 --a heuristic --b heuristic --gate none --p95 none
//
// Games come in pairs with the same seed and decks; only the seats swap, so
// neither bot gains from the deal or from going first. A bot against itself
// plays each seed once: swapping identical bots would replay the same game.
// Win rate counts every
// game, so draws and games stopped at the action cap count against bot A. Any
// illegal action or engine error fails the run. Results are the same on every
// run; only the times vary.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { decide, heuristicBot, randomBot } from '../src/ai';
import type { Bot } from '../src/ai';
import { loadSyn, SYN_DECK_NAMES } from '../src/cards';
import { actor, applyAction, createGame, seedRng } from '../src/engine';
import type { CardCatalog, GameState, PlayerId, RngState } from '../src/engine';

const BOTS: Record<string, Bot> = { heuristic: heuristicBot, random: randomBot };
const MAX_ACTIONS = 5000;

interface Options {
  games: number;
  a: string;
  b: string;
  gate: number | null;
  p95: number | null;
}

/** A number in [min, max], or null for 'none'. Anything else is an error, so a typo cannot switch the gate off. */
function limit(flag: string, value: string, min: number, max: number): number | null {
  if (value === 'none') return null;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${flag} must be a number from ${min} to ${max}, or none (got "${value}")`);
  return n;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { games: 504, a: 'heuristic', b: 'random', gate: 0.8, p95: 50 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    i++;
    if (flag === '--games') opts.games = Number(value);
    else if (flag === '--a') opts.a = value;
    else if (flag === '--b') opts.b = value;
    else if (flag === '--gate') opts.gate = limit(flag, value, 0, 1);
    else if (flag === '--p95') opts.p95 = limit(flag, value, 0, 60_000);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(opts.games) || opts.games < 18 || opts.games % 18 !== 0) throw new Error('--games must be a multiple of 18 (9 deck pairings x 2 seatings)');
  for (const name of [opts.a, opts.b]) if (!BOTS[name]) throw new Error(`unknown bot ${name}; known: ${Object.keys(BOTS).join(', ')}`);
  return opts;
}

interface GameRecord {
  seed: string;
  /** Which bot sat in seat 0. */
  aSeat: PlayerId;
  /** 'a', 'b', 'draw' or 'cap'. */
  outcome: 'a' | 'b' | 'draw' | 'cap';
  aStarted: boolean;
  turns: number;
  actions: number;
}

function play(seed: string, decks: [string[], string[]], catalog: CardCatalog, seats: [Bot, Bot], aSeat: PlayerId, times: Map<string, number[]>): GameRecord {
  const created = createGame({ seed, decks }, catalog);
  if (!created.ok) throw new Error(`${seed}: setup failed: ${JSON.stringify(created.errors)}`);
  let state: GameState = created.state;
  const rngs: [RngState, RngState] = [seedRng(`bot-${seed}-0`), seedRng(`bot-${seed}-1`)];
  let actions = 0;
  for (; !state.result && actions < MAX_ACTIONS; actions++) {
    const p = actor(state);
    if (p === null) throw new Error(`${seed}: no player to act at action ${actions}`);
    const bot = seats[p];
    const t0 = performance.now();
    const d = decide(state, catalog, p, bot, rngs[p]);
    const elapsed = performance.now() - t0;
    times.get(bot.name)?.push(elapsed);
    rngs[p] = d.rng;
    const r = applyAction(state, catalog, d.action);
    if (!r.ok) throw new Error(`${seed}: ${bot.name} played an illegal ${d.action.type}: ${r.error.code}`);
    state = r.state;
  }
  const result = state.result;
  const outcome = result === null ? 'cap' : result.kind === 'draw' ? 'draw' : result.winner === aSeat ? 'a' : 'b';
  return { seed, aSeat, outcome, aStarted: state.starting === aSeat, turns: state.turn, actions };
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const syn = loadSyn();
  if (!syn.ok) throw new Error('the SYN set does not load');
  const decks = SYN_DECK_NAMES.map((n) => syn.decks[n]);
  const a = BOTS[opts.a] as Bot;
  const b = BOTS[opts.b] as Bot;
  // Same-named bots share one timing list, and one seat order decides who is "A".
  const times = new Map<string, number[]>([[a.name, []], [b.name, []]]);
  const seedsPerPairing = opts.games / 18;
  // Swapping a bot with itself would replay the very same game, so a mirror match plays each seed once.
  const mirror = a.name === b.name;
  const seatings: readonly PlayerId[] = mirror ? [0] : [0, 1];
  const records: GameRecord[] = [];
  const started = performance.now();
  for (let k = 0; k < seedsPerPairing; k++) {
    for (const [i, first] of decks.entries()) {
      for (const [j, second] of decks.entries()) {
        const seed = `sim-${i}${j}-${k}`;
        for (const aSeat of seatings) {
          const seats: [Bot, Bot] = aSeat === 0 ? [a, b] : [b, a];
          records.push(play(seed, [[...first], [...second]], syn.catalog, seats, aSeat, times));
        }
      }
    }
  }
  const seconds = (performance.now() - started) / 1000;

  const count = (f: (r: GameRecord) => boolean) => records.filter(f).length;
  const rate = (n: number, d: number) => (d === 0 ? 0 : n / d);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const winRate = rate(count((r) => r.outcome === 'a'), records.length);
  const firstGames = count((r) => r.aStarted);
  const firstRate = rate(count((r) => r.aStarted && r.outcome === 'a'), firstGames);
  const secondRate = rate(count((r) => !r.aStarted && r.outcome === 'a'), records.length - firstGames);
  const avgTurns = records.reduce((n, r) => n + r.turns, 0) / records.length;
  const fingerprint = createHash('sha256')
    .update(records.map((r) => `${r.seed}:${r.aSeat}:${r.outcome}:${r.turns}:${r.actions}`).join('\n'))
    .digest('hex')
    .slice(0, 16);

  console.log(
    mirror
      ? `simulate: ${records.length} distinct games, A = B = ${opts.a} (${seedsPerPairing} seeds x 9 deck pairings; A sits in seat 0, so A's results are seat 0's)`
      : `simulate: ${records.length} games, A = ${opts.a}, B = ${opts.b} (${seedsPerPairing} seeds x 9 deck pairings x 2 seatings)`,
  );
  console.log(`  A wins ${pct(winRate)} (${count((r) => r.outcome === 'a')}); B wins ${count((r) => r.outcome === 'b')}; draws ${count((r) => r.outcome === 'draw')}; stopped at the action cap ${count((r) => r.outcome === 'cap')}`);
  console.log(`  A wins ${pct(firstRate)} going first (${firstGames} games), ${pct(secondRate)} going second (${records.length - firstGames} games)`);
  const firstWins = count((r) => (r.aStarted && r.outcome === 'a') || (!r.aStarted && r.outcome === 'b'));
  console.log(`  the player going first wins ${pct(rate(firstWins, records.length))} of games`);
  console.log(`  average game: ${avgTurns.toFixed(1)} turns, ${(records.reduce((n, r) => n + r.actions, 0) / records.length).toFixed(0)} actions`);
  let p95A = 0;
  for (const [name, list] of times) {
    const sorted = [...list].sort((x, y) => x - y);
    const p95 = percentile(sorted, 0.95);
    if (name === a.name) p95A = p95;
    console.log(`  ${name} decisions: ${sorted.length}, p50 ${percentile(sorted, 0.5).toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${(sorted[sorted.length - 1] ?? 0).toFixed(2)} ms`);
  }
  console.log(`  results fingerprint ${fingerprint} (the same on every run); ${seconds.toFixed(1)} s`);

  const failures: string[] = [];
  if (opts.gate !== null && winRate < opts.gate) failures.push(`A's win rate ${pct(winRate)} is below the gate ${pct(opts.gate)}`);
  if (opts.p95 !== null && p95A > opts.p95) failures.push(`A's p95 decision time ${p95A.toFixed(2)} ms is over ${opts.p95} ms`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log(opts.gate === null && opts.p95 === null ? 'simulate: done (no gate)' : 'simulate: gate passed');
}

try {
  main();
} catch (e) {
  console.error(`simulate failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
