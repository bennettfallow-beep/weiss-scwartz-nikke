// The only source of randomness in the app. A new game takes two fresh seeds:
// one for the game's shuffles and a separate one for the computer player, so
// the computer can never work out the deck order from its own seed.
import { getRandomBytes } from 'expo-crypto';

/** 128 bits of fresh entropy as 32 hex characters. Throws if the platform has no secure random source. */
export function freshSeed(): string {
  return Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seeds for a new game. Call only from a button handler, never while rendering. */
export function freshSeeds(): { gameSeed: string; botSeed: string } {
  const gameSeed = freshSeed();
  let botSeed = freshSeed();
  while (botSeed === gameSeed) botSeed = freshSeed();
  return { gameSeed, botSeed };
}
