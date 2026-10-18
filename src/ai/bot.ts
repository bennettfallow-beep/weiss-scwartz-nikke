// What a computer player is: a pure function from what its player may see
// (the view) and the moves it may make (its legal actions) to one of those
// moves. It never sees the game state itself, so it cannot know hidden cards.

import type { Action, CardCatalog, GameView, RngState } from '../engine';

export interface Decision {
  action: Action;
  /** The bot's own random source after this decision (seeded tie-breaks); the game's is never touched. */
  rng: RngState;
}

export interface Bot {
  readonly name: string;
  /** Picks one of `legal` (never empty). Must not throw. */
  choose(view: GameView, legal: readonly Action[], catalog: CardCatalog, rng: RngState): Decision;
}
