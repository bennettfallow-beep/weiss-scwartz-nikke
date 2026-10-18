# The computer opponent

How the computer player in `src/ai` decides, in plain words. It is a "heuristic" player: it
gives every move it may make a score from simple card-game rules of thumb, and plays the
highest. It does not look ahead, and it never sees cards its seat could not see.

## What it may look at

- **The view.** It gets the same view a human player in its seat gets:
  - its own hand;
  - every public zone;
  - how many cards are in each hidden zone;
  - the current power and soul of every stage card;
  - this turn's log.
- **Its legal moves.** It gets the list of moves the rules allow right now, and must pick one
  of them.
- **The card list.** It gets the printed card data (names, numbers, abilities). That is
  public.

Only one function, `decide()` in `src/ai/decide.ts`, touches the full game. It builds the view
and the move list and hands those over, and it rejects an answer that is not a legal move.
Tests check:
- that no other file in `src/ai` touches the game state;
- that swapping around every card the player cannot see (the other hand, both decks, both
  stocks) never changes a single decision.

## How it plays

| Decision | Rule of thumb |
|---|---|
| Mulligan | Send back climaxes, cards of level 2 or more, events above level 0, and level-1 characters beyond the best two. |
| Clock | Clock the least useful card while it is safe: always at level 0-1, at level 2 only with 3 or fewer clock cards, never at level 3. |
| Level up | Put a card of the color the hand most needs into the level zone (a color not already there). |
| Main phase | Play characters into empty center positions first. Replace a character only if the new one is clearly better. Play events and abilities whose effect is worth more than their cost. Use each activated ability at most once a turn. Swap positions only when that strictly improves the line-up (strong, standing characters in the center). |
| Climax | Play one when two or more attacks will follow (one on the first player's first turn, so then only with a spare climax in hand). |
| Attack | Attack directly when nothing is in front. Otherwise attack frontally when the attacker wins or ties the battle, and from the side when it would lose. Attack with everything that can. |
| Counter step | Use Backup or a counter event only when it saves the defender (or at least takes the attacker down with it). |
| Encore | Pay for characters worth more than the stock. |
| Trigger icons | Take the extra stock, draw (unless the hand is full), the best card back from the waiting room, and return the opponent's strongest character. |
| Ability choices | Boosts go to its own strongest character; removal goes to the opponent's strongest. Discards throw away the least useful cards. Salvage and "look at the top" take the most useful. |
| End of turn | Discard down to 7 one card at a time, spare climaxes first. |
| Order of abilities and icons | The first option. |

It never concedes and never reorders cards.

"Least useful" and "most useful" use a card worth score:
- **Characters:** power, soul and level, plus a little for each ability.
- **Discounts:** a character whose level is far above the player's level is worth less for now;
  level-0 characters are worth less later in the game.
- **Climaxes:** one climax in hand is worth keeping; more are not.

Equal scores are settled by the bot's own seeded random source. That source is separate from the
game's, so a game with the same seed and the same moves always plays out the same way.

## Checking it: `npm run simulate`

The simulator plays the computer player against a player that picks moves at random:
- **Games:** 504, which is every ordered pairing of the 3 SYN decks × 28 seeds × 2 seatings.
- **Seat swap:** each seed is played twice with the seats swapped, so neither side gains from
  the deal or from going first.
- **Pass mark:** the computer player must win at least 80% of all games (draws and unfinished
  games count as losses).
- **Speed:** 95% of its decisions must take under 50 ms.
- **Errors:** any illegal move or engine error fails the run.
- **Repeatability:** every run gives the same result. The "results fingerprint" line proves it;
  only the times vary.

Other match-ups: `npm run simulate -- --games 180 --a heuristic --b heuristic --gate none --p95 none`.

### Results (2026-10-18)

| Match-up | Result |
|---|---|
| Computer vs random, 504 games | Computer wins all 504 (100%), going first and going second. |
| Decision time | p50 0.19 ms, p95 0.50 ms. |
| Average game | 12.9 turns. |
| Computer vs computer, 180 games | The second player wins 57.8%: the first player gets only one attack on turn 1. |

## Limits

- **No look-ahead.** It does not plan a turn as a whole, or count the opponent's likely damage.
- **Card abilities are judged roughly, from their text.** "You may" is always accepted, and an
  "if" counts as half of each branch.
- **The only pass mark is against random play.** A practised human should beat it.
