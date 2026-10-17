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

## Abilities (M3)

Card abilities are data in the card definition, never code, so imported card sets are safe to
load. The language is small and closed; everything outside it is in `docs/KNOWN_GAPS.md`.

- **Where they live.** `CardDef.abilities` (characters and climaxes) and `CardDef.effect`
  (events). Types are in `src/engine/model/abilities.ts`.
- **Three kinds** (CR 8.1):
  - `activated`: used in the main phase or the opponent's counter step, from the stage. It always
    has a cost.
  - `automatic`: triggered when this card is played, attacks or becomes reversed, or when a
    climax is played. It may carry an optional "you may pay" cost.
  - `continuous`: power or soul modifiers, optionally only while conditions hold.
- **Effect steps:** `choose`, `draw`, `discard`, `stockFromDeck`, `heal`, `power`, `soul`,
  `damageOpp`, `salvage`, `lookTop`, `sendToWaiting`, `returnToHand`, `may`, `if`.
  - Steps after a `choose` refer to its picks by name.
  - "You" means the ability's master.
- **Validation.** `validateCatalog` checks ability data. Each problem gets a stable code
  (`ABILITY_*`) and a path (e.g. `abilities.0.effect.1.count`). The checker never throws. It also
  enforces rules the engine relies on:
  - a choose name is used once per ability;
  - a cost rests the card at most once, and putting the card into the waiting room is the
    last part of a cost.
- **Card text.** `cardText(def)` renders the language as deterministic English. Two different
  abilities never read the same:
  - a "you may" or "if" inside a branch is bracketed when anything follows it;
  - with more than one choice in view, a reference names its choice by place ("the second chosen
    character").

  Checked exhaustively for small abilities, about 160,000 per search.

How they run:

- **One at a time.** The ability being resolved is a frame in `s.resolving`. A `{ t: 'frame' }`
  task runs one op of it. Each card move is its own task, so a refresh or level up can still cut
  in, and a JSON copy of the state can resume anywhere.
- **Costs.** Checked in full before anything is paid (CR 8.4.2.2). Paid in the order written,
  in one step (CR 8.4.2.1). Stock is taken from the top.
- **Automatic abilities.** Put into standby where the event happens (`rules/triggers.ts`), and
  played in the next check timing: turn player first, choosing the order if several can be played.
  - An ability whose card has moved still resolves; what it can no longer do fails (CR 8.7.7).
  - An ability that cannot be played right now (an Encore short of stock) waits in standby in case
    another ability changes that. Once none of a player's abilities can be played, they are used up.
    Every v1 cost is optional, so this loses no outcome (CR 8.7.3.2).
- **Continuous abilities.** Computed whenever power or soul is read, from the stage characters
  and climax-area climaxes whose conditions hold. A card entering the stage is affected at once
  (CR 8.9.3).
  - One-shot "+X until end of turn" changes stay with the card objects they hit (CR 8.9.2).
  - Duration `game` survives end of turn.
- **Activated abilities in the main phase.** Every activated ability is usable there, counter-icon
  ones included (CR 2.8.2.1). The opponent's Counter Step allows only counter-icon ones.
- **Choices.**
  - A `pick` prompt asks for cards one CHOOSE_CARD at a time. PASS ends it once the minimum is met.
  - A fixed number must be picked as far as possible (CR 8.6.3.1). "Up to" allows none.
  - A filtered pick from a hidden zone (hand, deck) may find nothing (CR 8.6.3.1.4, owner decision
    2026-10-16).
  - An `optional` prompt (ACCEPT / PASS) asks "you may", "pay the cost?" and "look at / draw the
    next card?".
  - "You may A; if you do B; if not C": C also runs when A was impossible. A counts as done only
    if it can be done in full: the whole stated number of cards (CR 8.6.4 leaves partial actions
    open; this is the engine's reading). It is judged from public information when the player
    says yes, with two exceptions:
    - Looking at the deck counts as done once one card can be looked at, because a look ends
      normally when the deck runs short (CR 3.2.3.3).
    - A discard chosen by card information ("a red card") is judged after the pick: which hand
      cards qualify is hidden, so whenever the hand holds at least the stated number of cards
      (public), the yes is followed by the pick, which may find nothing. B runs if the stated
      number of cards was picked, otherwise C. With fewer cards in hand, C runs at once.
- **Prompts never reveal hidden cards.** Whether a prompt appears depends only on what both players
  can see:
  - A filtered pick from the hand or from looked-at cards is asked whenever there are such cards,
    even if none qualify. The player then just ends it.
  - Its bounds come from the number of those cards, not from the ones that qualify, and it ends
    only at its maximum or when the player ends it, so its length says nothing either.
  - "You may" around such a discard is followed by the pick whatever cards the hand holds (above).
  - Conditions never look at hidden cards: the validator rejects a count of hand or stock cards by
    their information (an unfiltered count is a public number and is allowed).
  - An automatic ability's "pay the cost?" is asked whenever the cost could be paid as far as the
    opponent can tell. ACCEPT is offered only when it really can.
- **Looking at the deck** (`lookTop`). Only the looker sees the cards: `projectView` shows them to
  that player only, and `look` events and the other player's CHOOSE_CARD answers are redacted.
  The rest go back on top or to the bottom in a chosen order, or to the waiting room.

Not in v1: costs or effects that change card level, cost or color. The play requirements still
read printed values.

## API (`src/engine/index.ts`)

| Function | Does |
|---|---|
| `createGame(setup, catalog)` | Validates decks, shuffles, picks the starting player at random, deals 5, stops at the first mulligan |
| `legalActions(state, catalog)` | Every legal action for the player being waited on, sorted. Never includes `CONCEDE` or `REORDER`. Includes `ACTIVATE` for usable activated abilities |
| `validate(state, catalog, action)` | `{ ok }` or `{ ok: false, error: { code, message } }` |
| `applyAction(state, catalog, action)` | Validates, applies, runs to the next decision. Returns `{ ok, state, events }`. Never mutates its input. Accepts untrusted input: anything malformed is an error value |
| `normalizeAction(raw)` | Rebuilds an action from untrusted input, keeping only the fields its type defines |
| `projectView(state, viewer)` | What one player may see: hidden zones as counts only, redacted log, fresh objects |
| `projectEvents(events, viewer)` | Redacts events for one player. **The `events` from `applyAction` are unredacted (they include the opponent's draws); always pass them through this before showing them** |
| `checkInvariants(state, catalog)` | List of broken invariants (empty is good) |
| `cardText(def)` / `validateCatalog(catalog)` | Card text from the ability language / catalog problems with codes and paths |
| `currentPower` / `currentSoul` | A card's power and soul now, with every effect and continuous ability applied |
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
