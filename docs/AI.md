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
- that no other file in `src/ai` touches the game state. Bot files may import only a short
  list of harmless engine helpers.
- that swapping around every card the player cannot see (the other hand, both decks, both
  stocks) never changes a single decision.
- that the zones, the look, its own decision and its legal moves name no card it cannot see. The
  log, effects and the current attack may name cards it saw earlier that have since gone out of
  sight.

## How it plays

| Decision | Rule of thumb |
|---|---|
| Mulligan | Send back climaxes, cards of level 2 or more, events above level 0, and level-1 characters beyond the best two. |
| Clock | Clock the least useful card while it is safe: always at level 0-1, at level 2 only with 3 or fewer clock cards, never at level 3. |
| Level up | Put a card of the color the hand most needs into the level zone (a color not already there). |
| Main phase | <ul><li>Play characters into empty center positions first. Replace a character only if the new one is clearly better.</li><li>Play events and abilities whose effect is worth more than their cost. An effect that would do nothing now is worth nothing: no character to choose, or "the defending character" outside a battle. So counter cards wait for the counter step.</li><li>Use each activated ability at most once a turn.</li><li>Swap positions only when that strictly improves the line-up: strong, standing characters in the center.</li></ul> |
| Climax | Play one when two or more attacks will follow. With only one attack (always the case on the first player's first turn), play one only if another climax is in hand. |
| Attack | <ul><li>Attack directly when nothing is in front.</li><li>Otherwise attack frontally when the attacker wins the battle, and from the side when it would lose.</li><li>On a tie both characters are reversed. It weighs that trade (the defender's worth against its own) against the soul a side attack would lose to the defender's level, and picks the better.</li><li>It attacks with everything that can.</li></ul> |
| Counter step | Use Backup or a counter event only when it saves the defender (or at least takes the attacker down with it). |
| Encore | Pay for characters worth more than the stock. If the position is now taken, the character there would be lost, so its worth counts against paying. |
| Trigger icons | <ul><li>Take the extra stock.</li><li>Draw, unless the hand is full.</li><li>Take the best card back from the waiting room.</li><li>Return the opponent's strongest character.</li><li>Standby onto a full stage only when the new character is worth more than the weakest one it pushes off.</li></ul> |
| Optional costs | Pay an automatic ability's optional cost when the effect is worth more than the cost. A cost that puts the card itself into the waiting room costs what that card is worth, or nothing if the card is reversed and leaving anyway. |
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

A bot against itself plays each seed once, because swapping two identical bots would replay the
same game. So `--games 180` gives 90 distinct games.

### Results (2026-10-18)

| Match-up | Result |
|---|---|
| Computer vs random, 504 games | Computer wins all 504 (100%), going first and going second. |
| Decision time | p50 0.20 ms, p95 0.52 ms. |
| Average game | 12.9 turns. |
| Computer vs computer, 90 distinct games | The player going first wins 41.1%. The first player gets only one attack on turn 1. |

## Limits

- **No look-ahead.** It does not plan a turn as a whole, or count the opponent's likely damage.
- **Card abilities are judged roughly, from their text.**
  - A "you may" step inside an effect is always accepted.
  - An "if" counts as half of each branch.
  - A choice counts as hitting whatever matches on the stage now.
- **The only pass mark is against random play.** A practised human should beat it.
