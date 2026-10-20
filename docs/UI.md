# The app screens (M5)

How the app looks and behaves, in plain words. M5 plays the three built-in starter decks.
Your own card file, card pictures, saving a game and the import screen come in M6.

## Screens

| Screen | What it shows |
|---|---|
| Home | Two buttons: **Two players, one phone** and **Play against the computer**. Also **How to play** and the rules version. |
| New game | A deck for each seat (Yellow, Red or Blue). The selected deck says "✓ Selected". Who goes first is random. |
| Pass the phone | Two-player games only. It names the player who should take the phone, plus public facts only: turn, phase and step. It shows no cards at all. |
| Board | The opponent at the top, you below, and the decision panel fixed at the bottom. |
| Game over | Who won and why, and how many turns it took. Then **Rematch** (same decks, new shuffle), **New game** or **Home**. |
| How to play | A short guide written for this app. |

## The board

- **Top bar:** the turn, whose turn it is, the phase and the attack step. Buttons for
  **Log** and **Menu**.
- **Each side:**
  - the counts: hand, deck and stock;
  - buttons for the level zone, clock and waiting room (tap one to see its cards);
  - the stage.
  - The opponent's stage is mirrored, as if they sat across the table. Your Center left
    faces their Center right, and Center faces Center.
- **Cards** are written out in words:
  - name, color, kind, level and cost, power and soul, and trigger icons;
  - on the stage, also **Standing**, **Rested** or **Reversed**. Current power and soul
    already include every effect; a changed value is highlighted.
  - The color is also a stripe on the card, but it is always written out too. Nothing
    relies on color alone.
- **Your hand** is a row of cards. Tap a highlighted card to see what it can do now. Long-press
  any card to read it in full.
- **Since your last move:** a few lines about what happened since you last acted.

## The decision panel

The panel at the bottom always says what you are deciding, in words. Every button stands for
one move the rules allow at that moment, and every allowed move has a button.

- **Mulligan:** tap cards to mark them, then press **Put back N cards and draw N**, or
  **Keep this hand**.
- **Main phase:** tap a highlighted card, in your hand or on the stage, or pick it from the
  list. Its choices appear, such as "Play to Center" or "Use ability". **End main phase**
  is always there.
- **Attacks:** one button per attack. For example, "Cadet: Front attack" shows both powers;
  "Side attack" shows how much soul it loses.
- **Abilities that ask:** the panel shows the ability's text, how many cards to choose, and
  which you have already chosen.
- **Undo last step** appears only when undoing is safe (see below).

## Two players on one phone

The board is shown only to the player whose decision it is. Whenever the decision moves to the
other player, the app shows **Pass the phone to Player 2**, and the board is not even in the
page. That happens:

- at the start (with who goes first) and after each player's mulligan;
- at every **counter step**. When you make a front attack, the defender is always asked
  whether to counter, even with nothing to play. So the question itself gives nothing away.
- when a choice belongs to the other player (an encore, or an ability that makes them
  discard), and at the start of each turn;
- when the app comes back from the background (another app, a locked screen or a hidden tab).
  Any open panel is closed first.

Press **I'm Player 2: show my cards** only when the right person holds the phone.

## Against the computer

You see the board all the time. The computer makes one move about every half second, so you can
follow it. It never sees your hand or anything else hidden (see `docs/AI.md`). Its random choices
use its own random number source, which is separate from the one that shuffles the decks.

## Undo

You may take back your last step while all three of these hold:
- it is still your decision;
- nothing new was revealed: no card drawn, looked at, shuffled or flipped for a trigger;
  no stock paid; no damage dealt;
- it was not a mulligan or a concede, and it did not end the game.

Examples you can undo: moving characters between positions, ending a phase, playing a free
character, and choosing not to clock. Undo takes the game back exactly as it was, including what
the other player has been shown.

## Conceding and quitting

**Menu → Concede this game** asks once more, then ends the game. **Quit to home** leaves the game.
M5 has no saving, so quitting or reloading the page loses the game. On the web, the browser
asks before you leave a game in progress.

## The private web link

The web version is a set of static files built from this repository (`npm run build:web`).
Only the original starter cards are in it. To try it on your phone:

1. Sign in to Vercel in your phone's browser.
2. Open the link you were sent.

A visitor who is not signed in gets a login page, not the app.

## Limits in M5

- **Not saved:** no save or resume yet, so a reload loses the game (M6).
- **Not tested on real phones:** tests run in Chromium at two phone sizes only (360×640 and
  390×844). Safari, real phones, safe areas and gestures are untested until you run the
  device checklist (M6).
- **No full accessibility pass yet** (M6). There are already readable labels, buttons at
  least 44 points tall, and no color-only information.

## For maintainers

- **Layers:**
  - The UI (`src/ui`) reaches the game only through `src/session`. The session hands out
    screen models:
    - `screenFor`: board, prompt and recent log;
    - `handoffScreen`;
    - `gameOverScreen`;
    - `logFor`;
    - `cardDetail`;
    - `mulliganChoice`.
  - The UI sends back only an action key from those models.
  - `tests/architecture/ui-boundary.test.ts` enforces this: no engine imports except types
    and the rules version, no access to `game`, `seed`, `rng` or `botRng`, and no
    `Math.random`.
- **Privacy tests:**
  - `tests/session/hidden-info.test.ts`: no hidden card id, seed or generator state in any
    screen. Screens are the same when hidden cards are shuffled. A player learns a card
    only if they could see it.
  - `e2e/hotseat-privacy.spec.ts`: no card name or id in the page at any handoff, the
    counter step and returning from the background included; nothing stored.
- **Randomness:**
  - `src/ui/platform/entropy.ts` is the only source. It makes two separate 128-bit seeds
    with expo-crypto: one for the game, one for the computer.
  - The browser tests fix randomness by replacing `crypto.getRandomValues` before the app
    loads; the app itself has no test switch for seeds.
  - `?fast=1` in the address removes the computer's delay; the tests use it.
- **Saves (M6 groundwork):**
  - `src/session/save.ts` already makes and checks versioned saves, records the card set's
    fingerprint, and runs a migration chain.
  - Saves contain the seed, because they must, to continue a game. They stay on the device
    and are never shown on screen. Someone with browser developer tools could still read
    them; nothing pretends otherwise.
  - Replays can be exported only once a game is over.
- **Deploy:** `public/vercel.json` is copied into `dist/`. It routes every path to the app,
  caches the hashed bundles, and asks search engines not to index the site.
