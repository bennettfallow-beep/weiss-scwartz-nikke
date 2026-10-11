import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hashSeed, nextInt, nextUint32, seedRng, shuffle } from '../../src/engine';
import type { RngState } from '../../src/engine';

// Independent reference: the widely used closure-style sfc32 (bryc,
// "PRNGs in JavaScript"). Written separately from src/engine/core/rng.ts so a
// transcription error in one is caught by the other.
function referenceSfc32(a0: number, b0: number, c0: number, d0: number): () => number {
  let a = a0 | 0;
  let b = b0 | 0;
  let c = c0 | 0;
  let d = d0 | 0;
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

function draws(rng: RngState, count: number): number[] {
  const out: number[] = [];
  let state = rng;
  for (let i = 0; i < count; i++) {
    const [x, next] = nextUint32(state);
    out.push(x);
    state = next;
  }
  return out;
}

describe('seeded RNG', () => {
  it('matches an independent sfc32 implementation for 1000 draws', () => {
    const [a, b, c, d] = hashSeed('frontline');
    const ref = referenceSfc32(a, b, c, d);
    for (let i = 0; i < 15; i++) ref(); // same warm-up as seedRng
    const expected = Array.from({ length: 1000 }, () => ref());
    expect(draws(seedRng('frontline'), 1000)).toEqual(expected);
  });

  it('is frozen: these values must never change, or old saves stop replaying', () => {
    expect(hashSeed('frontline')).toMatchInlineSnapshot(`
      [
        1197084051,
        487188035,
        2709795335,
        301604654,
      ]
    `);
    expect(draws(seedRng('frontline'), 5)).toMatchInlineSnapshot(`
      [
        1489759091,
        1562103188,
        1219389366,
        3087756623,
        645262341,
      ]
    `);
    expect(shuffle(seedRng('frontline'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])[0]).toMatchInlineSnapshot(`
      [
        10,
        3,
        6,
        5,
        8,
        4,
        1,
        7,
        9,
        2,
      ]
    `);
  });

  it('gives the same sequence for the same seed', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(draws(seedRng(seed), 20)).toEqual(draws(seedRng(seed), 20));
      }),
    );
  });

  it('gives different sequences for different seeds', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(draws(seedRng(`seed-${i}`), 4).join(','));
    expect(seen.size).toBe(500);
  });

  it('never mutates the state it is given', () => {
    const rng = Object.freeze(seedRng('x'));
    expect(() => nextUint32(rng)).not.toThrow();
    expect(() => nextInt(rng, 7)).not.toThrow();
    expect(() => shuffle(rng, [1, 2, 3])).not.toThrow();
  });

  it('nextInt stays in [0, n)', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 2 ** 32 }), (seed, n) => {
        const [x] = nextInt(seedRng(seed), n);
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(n);
      }),
    );
  });

  it('nextInt rejects invalid bounds', () => {
    const rng = seedRng('x');
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 32 + 1]) {
      expect(() => nextInt(rng, bad)).toThrow(RangeError);
    }
  });

  it('nextInt is roughly uniform (chi-square, 6 buckets, 60k draws)', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    let rng = seedRng('uniformity');
    const total = 60_000;
    for (let i = 0; i < total; i++) {
      const [x, next] = nextInt(rng, 6);
      counts[x] = (counts[x] ?? 0) + 1;
      rng = next;
    }
    const expected = total / 6;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // df = 5; p = 0.001 critical value is 20.52. A fixed seed makes this deterministic.
    expect(chi2).toBeLessThan(20.52);
  });

  it('shuffle returns a permutation and leaves the input untouched', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer(), { maxLength: 60 }), (seed, items) => {
        const input = Object.freeze(items.slice());
        const [out] = shuffle(seedRng(seed), input);
        expect(out).toHaveLength(input.length);
        expect(out.slice().sort((x, y) => x - y)).toEqual(input.slice().sort((x, y) => x - y));
        expect(out).not.toBe(input);
      }),
    );
  });

  it('shuffle reaches every ordering of 3 items', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 200; i++) orders.add(shuffle(seedRng(`s${i}`), ['a', 'b', 'c'])[0].join(''));
    expect(orders.size).toBe(6);
  });
});
