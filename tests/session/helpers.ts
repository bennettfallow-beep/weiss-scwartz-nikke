// Drives sessions the way the app does: through the screen model's buttons
// only, with a seeded random player.

import { nextInt, seedRng } from '../../src/engine';
import type { CardId, RngState } from '../../src/engine';
import { acceptHandoff, botToMove, choose, gameOverScreen, mulliganChoice, needsHandoff, newGame, screenFor, starterCards, stepBot } from '../../src/session';
import type { NewGameOptions, Prompt, Screen, Session } from '../../src/session';

export const starter = starterCards();
export const cards = starter.source;
export const DECKS = ['yellow', 'red', 'blue'] as const;

export function start(options: NewGameOptions): Session {
  const r = newGame(cards, options);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.session;
}

/** Every action key a prompt offers (the mulligan's subsets are not listed; see subsetKeys). */
export function promptKeys(p: Prompt): string[] {
  return [...p.choices.map((c) => c.key), ...p.groups.flatMap((g) => g.choices.map((c) => c.key))];
}

/** Every subset of the mulligan hand, as card ids. */
export function subsets(ids: readonly CardId[]): CardId[][] {
  const out: CardId[][] = [];
  for (let m = 0; m < 1 << ids.length; m++) out.push(ids.filter((_, i) => (m >> i) & 1));
  return out;
}

function pickIndex(rng: RngState, n: number): [number, RngState] {
  return nextInt(rng, n);
}

/** A random key from the screen's prompt; for the mulligan, a random subset through mulliganChoice. */
export function randomKey(s: Session, screen: Screen, rng: RngState): [string, RngState] {
  const p = screen.prompt;
  if (!p) throw new Error('no prompt for the viewer');
  if (p.layout === 'subset') {
    const all = subsets((p.subset ?? []).map((t) => t.id));
    const [i, next] = pickIndex(rng, all.length);
    const c = mulliganChoice(s, all[i] ?? []);
    if (!c) throw new Error('mulligan subset without a legal action');
    return [c.key, next];
  }
  const keys = [...new Set(promptKeys(p))];
  if (keys.length === 0) throw new Error(`prompt ${p.kind} has no choices`);
  // Prefer not to end phases at once, so games go deep enough to use most features.
  const [i, next] = pickIndex(rng, keys.length);
  return [keys[i] as string, next];
}

export interface StepInfo {
  kind: 'handoff' | 'bot' | 'human';
  before: Session;
  after: Session;
  screen: Screen | null;
}

/** Plays a session to the end (or `max` steps), calling `each` after every step. */
export function playOut(session: Session, seed: string, each: (info: StepInfo) => void = () => {}, max = 6000): Session {
  let s = session;
  let rng = seedRng(`player-${seed}`);
  for (let i = 0; i < max && gameOverScreen(s) === null; i++) {
    const before = s;
    if (needsHandoff(s) !== null) {
      s = acceptHandoff(s);
      each({ kind: 'handoff', before, after: s, screen: null });
      continue;
    }
    if (botToMove(s)) {
      const r = stepBot(s);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      s = r.session;
      each({ kind: 'bot', before, after: s, screen: null });
      continue;
    }
    const screen = screenFor(s);
    if (!screen) throw new Error('no screen and no handoff');
    const [key, next] = randomKey(s, screen, rng);
    rng = next;
    const r = choose(s, key);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    s = r.session;
    each({ kind: 'human', before, after: s, screen });
  }
  return s;
}
