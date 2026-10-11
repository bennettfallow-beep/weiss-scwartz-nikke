// Stage position relations (CR 3.6.4-3.6.6).

import type { Slot } from './types';

export const CENTER_STAGE: readonly Slot[] = [1, 2, 3];
export const BACK_STAGE: readonly Slot[] = [4, 5];

export function isCenter(slot: Slot): boolean {
  return slot <= 3;
}

/** Pairs 1-4, 2-4, 2-5, 3-5 (CR 3.6.5). */
const FRONT_BACK: readonly (readonly [Slot, Slot])[] = [
  [1, 4],
  [2, 4],
  [2, 5],
  [3, 5],
];

/** Center positions "in front of" a back position; empty for a center position. */
export function inFrontOf(slot: Slot): Slot[] {
  return FRONT_BACK.filter(([, back]) => back === slot).map(([front]) => front);
}

/** Back positions "behind" a center position; empty for a back position. */
export function behind(slot: Slot): Slot[] {
  return FRONT_BACK.filter(([front]) => front === slot).map(([, back]) => back);
}

/** The opponent's center position facing this one: 1<->3, 2<->2, 3<->1 (CR 3.6.6). Null for back stage. */
export function facing(slot: Slot): Slot | null {
  if (slot === 1) return 3;
  if (slot === 2) return 2;
  if (slot === 3) return 1;
  return null;
}
