// The engine work queue. Kept apart from flow.ts so every rules module can
// queue tasks without importing the run loop.

import type { GameState, Task } from '../model/types';

/** Puts tasks at the front of the queue, in the given order. */
export function queue(s: GameState, ...tasks: Task[]): void {
  s.tasks.unshift(...tasks);
}
