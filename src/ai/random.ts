// The random player: an action type uniformly at random, then an action of
// that type, so types with many options (mulligans, swaps) do not swamp the
// game. The fuzz tests play it.

import { nextInt } from '../engine';
import type { Action, RngState } from '../engine';
import type { Bot } from './bot';

export function randomChoice(legal: readonly Action[], rng: RngState): [Action, RngState] {
  const types = [...new Set(legal.map((a) => a.type))];
  const [ti, r1] = nextInt(rng, types.length);
  const ofType = legal.filter((a) => a.type === types[ti]);
  const [ai, r2] = nextInt(r1, ofType.length);
  return [ofType[ai] as Action, r2];
}

export const randomBot: Bot = {
  name: 'random',
  choose: (_view, legal, _catalog, rng) => {
    const [action, next] = randomChoice(legal, rng);
    return { action, rng: next };
  },
};
