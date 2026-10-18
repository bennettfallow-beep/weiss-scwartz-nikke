// The one place a computer player meets the game state. It hands the bot only
// what that player may see (the view, with this turn's log) and that player's
// legal actions, so no bot can read hidden cards. A test checks that no other
// file in src/ai touches the state.

import { actionKey, actor, legalActions, projectView } from '../engine';
import type { CardCatalog, GameState, PlayerId, RngState } from '../engine';
import type { Bot, Decision } from './bot';

/** `bot`'s move for `player`, who must be the player the game is waiting on. */
export function decide(state: GameState, catalog: CardCatalog, player: PlayerId, bot: Bot, rng: RngState): Decision {
  const legal = legalActions(state, catalog);
  if (actor(state) !== player || legal.length === 0) throw new Error(`player ${player} has no decision to make`);
  const view = projectView(state, player, { catalog, logSinceTurn: state.turn });
  const decision = bot.choose(view, legal, catalog, rng);
  const key = actionKey(decision.action);
  if (!legal.some((a) => actionKey(a) === key)) throw new Error(`${bot.name} chose an action that is not legal: ${key}`);
  return decision;
}
