# Rules engine

`src/engine` is pure TypeScript with no dependencies. It knows the rules; it
knows nothing about screens.

## Model

- **`GameState`** (`src/engine/model/types.ts`) is plain JSON. Zone arrays are ordered
  **bottom → top**: the last element is the top card (deck top, newest waiting-room card).
- **Cards.** `state.cards[id]` is a card instance `{ id, def, owner, epoch }`.
  - Instance ids look like `p0-07`. `def` points into a `CardCatalog`.
  - `epoch` is the card's object identity (CR 3.1.4). It changes on every zone change
    except a move between stage positions.
- **Stage.** `players[p].stage[i]` is stage position `i + 1`. Positions 1-3 are center
  stage (left to right) and 4-5 are back stage. A position normally holds 0 or 1 card.
  Extra cards are removed by the check timing (CR 9.6.2), so a position can briefly hold two.
- **Climax area.** `players[p].climax` follows the same pattern as the stage.
- **`pending`** is the one decision the game is waiting for:
  - M1: `mulligan`, `clock`, `play` (main, climax or counter window), `levelUp`,
    `interruptOrder`, `discard`.
  - Combat: `attack` (declare or end the Attack Phase), `iconOrder`, `choose` (a card, for
    a trigger icon or the Encore Step), `chooseSlot`, `chooseDest`, `confirm` (an optional
    yes/no icon action), `encore` (pay or not) and `autoOrder`.
- **`result`** is set when the game ends. It is either a win or a draw.

## Flow

The engine keeps a queue of small tasks (`state.tasks`). `run` pops tasks until a decision
is needed. Before every task it runs any due **interrupt rule actions**: refresh and level
up (CR 9.1.2.1). That is how a refresh can happen between the two cards of "draw two".

- **Phase scripts.** These are in `src/engine/rules/flow.ts` `enterPhase`, in rule order.
- **Attack Phase.** Step scripts are in `src/engine/rules/combat.ts` `enterStep`:
  - Declaration → Trigger → Counter (frontal attacks only) → Damage → Battle (frontal only)
    → back to Declaration. Ending the Attack Phase goes to the Encore Step, then the End Phase.
  - `s.attack` records the attack type and the attacker and facing card objects
    (`{card, epoch}`) and positions. A character stops being the attacker or defender once
    it leaves its position.
  - When no character can attack, the phase ends without a prompt.
- **Damage.** `src/engine/rules/damage.ts`. Cards are revealed one at a time; a refresh can
  run between two cards. A climax cancels the damage. CR 9.2.2.1 (out of cards
  mid-damage) is an immediate loss.
- **Until end of turn.** Power and soul changes live in `s.effects`, keyed to one card
  object. They end after the End Phase check timing that follows the climax cleanup
  (CR 6.8.1.4). Shot's watch (`s.watchers`) ends then too.
- **Automatic abilities.** `src/engine/rules/autos.ts`. Every zone change is noted in
  `s.moved`. Each check timing turns those into standby abilities, then plays them after
  the rule actions: turn player first, choosing the order if they have several.
  - M2 has two rule-level abilities: default Encore [3 stock] on every character, and
    Shot's extra damage.
  - An Encore that cannot be paid, or whose card already left the waiting room, is used
    up without a prompt. Nothing in an M2 check timing can add stock; M3 abilities that
    can must revisit this.
- **Backup.** A card's `backup: {power, level, stock}` makes it usable from hand in the
  opponent's Counter Step. The cost is that much stock, then the card itself to the waiting
  room. The effect is +power to the defender until end of turn.
- **Check timing.** This is in `src/engine/rules/ruleActions.ts` `checkTiming`. It runs
  check-type rule actions and repeats until none are due:
  - loss (level 4, or no cards in deck and waiting room);
  - power 0 or less;
  - illegal cards (a non-character on stage, a non-climax in the climax area);
  - extra cards in a position.

  Then it plays standby automatic abilities (CR 8.5.1.2).
- **Play timings.** A check timing always runs before a play timing (CR 8.5.2). The Counter
  Step's play timing belongs to the non-turn player, who gets one action at most. It is
  always offered, even with nothing playable, so its presence leaks nothing.

## API (`src/engine/index.ts`)

| Function | Does |
|---|---|
| `createGame(setup, catalog)` | Validates decks, shuffles, picks the starting player at random, deals 5, stops at the first mulligan |
| `legalActions(state, catalog)` | Every legal action for the player being waited on, sorted. Never includes `CONCEDE` or `REORDER` |
| `validate(state, catalog, action)` | `{ ok }` or `{ ok: false, error: { code, message } }` |
| `applyAction(state, catalog, action)` | Validates, applies, runs to the next decision. Returns `{ ok, state, events }`. Never mutates its input. Accepts untrusted input: anything malformed is an error value |
| `normalizeAction(raw)` | Rebuilds an action from untrusted input, keeping only the fields its type defines |
| `projectView(state, viewer)` | What one player may see: hidden zones as counts only, redacted log, fresh objects |
| `projectEvents(events, viewer)` | Redacts events for one player. **The `events` from `applyAction` are unredacted (they include the opponent's draws); always pass them through this before showing them** |
| `checkInvariants(state, catalog)` | List of broken invariants (empty is good) |
| `replay(setup, catalog, actions)` / `stateHash(state)` | Determinism |

`CONCEDE` is accepted for either player at any time. `REORDER` lets an owner reorder
their own hand or waiting room at any time. No other zone can be reordered.

Logged events are frozen. Shuffles start from a canonical order, so neither the decklist
order nor a waiting-room reorder can steer them (CR 3.2.4). The seed and generator state
still decide every shuffle, so they must never be shown to players. Save files (M5) must
keep them out of anything a player can read.

## Writing rule tests

- Use `src/engine/testkit.ts`:
  - **`makeState(catalog, spec)`** builds any position. Name each player's zones with
    card definition ids, bottom → top. Pick where the engine starts (`start: 'main'`,
    `'clock'`, `'end'`, `'mulligan'`, ...). The engine runs to the first decision.
  - **`act(state, catalog, ...actions)`** applies actions and throws if one is illegal.
  - **`cardIn(state, player, zone, defId, nth)`** finds a card id; **`defsIn`** lists a zone's definitions.
  - **`ops`** gives low-level operations for the rare test that must go below the action API.
- Use the synthetic cards in `tests/helpers/catalog.ts`. A test that needs special cards
  adds them in its own file: `const cat = { ...catalog, X: {...} }`.
- Every rule test title starts with its matrix id, e.g. `it('[PLAY-01] ...')`.
- Assert on state **and** on `events` (or `state.log`) when order matters.
