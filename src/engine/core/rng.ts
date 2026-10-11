// Deterministic random numbers for the engine.
//
// The engine never creates entropy: a game's seed comes from the UI layer and
// the generator state lives inside GameState, so a game is fully replayable
// from (setup, actions). Functions here are pure: they take a state and return
// [value, nextState] without mutating anything.
//
// Generator: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator, 32-bit
// variant), seeded by hashing the seed string with cyrb128.

export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

const UINT32_RANGE = 0x1_0000_0000;
const WARMUP_ROUNDS = 15;

/** Hashes a string into four 32-bit words (cyrb128). */
export function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** One sfc32 step: returns an unsigned 32-bit integer and the next state. */
export function nextUint32(rng: RngState): [number, RngState] {
  const t = (((rng.a + rng.b) | 0) + rng.d) | 0;
  const next: RngState = {
    a: rng.b ^ (rng.b >>> 9),
    b: (rng.c + (rng.c << 3)) | 0,
    c: (((rng.c << 21) | (rng.c >>> 11)) + t) | 0,
    d: (rng.d + 1) | 0,
  };
  return [t >>> 0, next];
}

/** Creates a generator state from a seed string. Same seed, same sequence. */
export function seedRng(seed: string): RngState {
  const [a, b, c, d] = hashSeed(seed);
  let rng: RngState = { a: a | 0, b: b | 0, c: c | 0, d: d | 0 };
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    rng = nextUint32(rng)[1];
  }
  return rng;
}

/**
 * Uniform integer in [0, n). Uses rejection sampling so there is no modulo
 * bias. `n` must be an integer between 1 and 2^32.
 */
export function nextInt(rng: RngState, n: number): [number, RngState] {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`nextInt: n must be an integer in [1, 2^32], got ${n}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let state = rng;
  for (;;) {
    const [x, next] = nextUint32(state);
    state = next;
    if (x < limit) return [x % n, state];
  }
}

/** Fisher-Yates shuffle. Returns a new array; the input is not modified. */
export function shuffle<T>(rng: RngState, items: readonly T[]): [T[], RngState] {
  const out = items.slice();
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, i + 1);
    state = next;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, state];
}
