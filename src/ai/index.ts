// Public surface of the computer players. Other layers import from here only.

export type { Bot, Decision } from './bot';
export { decide } from './decide';
export { heuristicBot } from './heuristic';
export { randomBot, randomChoice } from './random';
