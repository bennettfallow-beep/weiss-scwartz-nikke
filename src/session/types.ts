// Data shapes of a game session: one game as the app runs it. The session
// holds the full game state, so the UI treats a Session as opaque and reads
// only the screen models built for one player (screen.ts).

import type { Action, CardCatalog, CardId, GameSetup, GameState, PlayerId, RngState } from '../engine';
import type { CardDisplay } from '../cards';

/** Two players sharing one phone, or one player against the computer. */
export type Mode = 'hotseat' | 'computer';

export interface Seat {
  readonly name: string;
  readonly kind: 'human' | 'computer';
  /** Deck key in the card source. */
  readonly deck: string;
}

/** A card set the app can play: the engine catalog, display data and named decks. */
export interface CardSource {
  readonly catalog: CardCatalog;
  readonly display: Readonly<Record<string, CardDisplay>>;
  /** Deck key -> 50 card definition ids. */
  readonly decks: Readonly<Record<string, readonly string[]>>;
  /** Deck key -> name shown to players. */
  readonly deckNames: Readonly<Record<string, string>>;
  /** Identifies the catalog in saves (save.ts). */
  readonly fingerprint: string;
  readonly label: string;
}

/** Card instance id -> definition id, for every card a player has seen. */
export type Memory = Readonly<Record<CardId, string>>;

/** The rules-level game. Undo swaps the whole record for the previous one. */
export interface GameRecord {
  readonly setup: GameSetup;
  readonly actions: readonly Action[];
  readonly state: GameState;
  /** What each player has seen; names in logs and prompts come only from here. */
  readonly memory: readonly [Memory, Memory];
  /** Log length right after each player's last decision ("since you last acted"). */
  readonly marks: readonly [number, number];
  /** The record before the last action, kept only while that action can be undone. */
  readonly prev: GameRecord | null;
}

export interface Session {
  readonly mode: Mode;
  readonly seats: readonly [Seat, Seat];
  readonly cards: CardSource;
  readonly game: GameRecord;
  /**
   * Hot-seat: the player who has taken the phone at the last handoff, or null
   * when the phone must be handed over. Against the computer: the human seat.
   */
  readonly holder: PlayerId | null;
  /** The computer player's own random source, separate from the game's. */
  readonly botRng: RngState | null;
}

export type SessionErrorCode =
  | 'BAD_SEED'
  | 'BOT_SEED_REQUIRED'
  | 'SAME_SEED'
  | 'BAD_DECK'
  | 'SETUP'
  | 'NOT_YOUR_DECISION'
  | 'HANDOFF_PENDING'
  | 'UNKNOWN_CHOICE'
  | 'GAME_OVER'
  | 'NO_BOT_TURN'
  | 'NO_UNDO'
  | 'ENGINE';

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
}

export type SessionResult = { ok: true; session: Session } | { ok: false; error: SessionError };
