# Plan: Weiss Schwarz game app (React Native / Expo)

## Context
You asked for a Weiss Schwarz game app. Decisions you made:
- Scope: playable 2-player rules engine, enforced and tested.
- Platform: native mobile, React Native + Expo, TypeScript.
- Play: hot-seat (2 humans, one device) + simple AI. No server.
- Cards: original synthetic placeholder cards + JSON schema/importer for your own data. No Bushiroad art or text in the repository.
- 2026-10-17 (M3b): you want to play the real Nikke set (English edition, from your own boxes) for personal use. Your personal card file lives in `local-cards/` (gitignored) or on your phone; card pictures are links the app downloads on the phone; nothing official is committed.
- Rules source: you upload the official Comprehensive Rules PDF.
- Location: a **separate new repo** (you create it; I attach it with `add_repo`).

`arkham-table` (the repo where this was planned) is an unrelated Arkham Horror tracker: `index.html`, README, no tooling. Nothing from it is reused except the idea of normalize-on-load saved state. **Nothing will be committed to arkham-table.**

## Limits (what I can and cannot do here)
| Can | Cannot |
|---|---|
| Build and test a pure-TS rules engine, AI, card importer (Vitest, fuzz) | Run iOS/Android simulators or a physical device |
| Run Expo **web** build + Playwright (Chromium preinstalled) for UI smoke and screenshots | Verify WebKit/iOS Safari, safe areas, back button, backgrounding, native file picker |
| Extract text from the rules PDF locally (`pdftotext`) | Read en.ws-tcg.com or docs.expo.dev (egress blocked) |
| Push to a repo once attached | Know the rules are right without the PDF (see Challenge) |

Native-device behavior stays **UNVERIFIED** until you run `docs/DEVICE_CHECKLIST.md` on a phone.

## Blockers before code (both cleared 2026-10-11)
1. Rules PDF: **received.** Weiß Schwarz (English Edition) Comprehensive Rules ver. 2.10, last updated 2025-09-17, 24 pages, sha256 `22ba30c0eae920dd36dcdd3e0fef13a84f1992235edf59351f0c6a66492d026a`. Read in full. It goes into the new repo only under gitignored `docs/_private/`; the repo carries section numbers + my paraphrase + this hash.
2. Repo: **`bennettfallow-beep/weiss-scwartz-nikke`.** First action after approval: `add_repo` (push access), clone, verify it's empty. Name contains "nikke": fine while private; the app display name and bundle id stay neutral, and rename the repo before it ever goes public.

## Rules intake findings (CR v2.10, primary source)
Where my earlier summary was wrong or incomplete. Each becomes a matrix row with this section cited.

| Topic | Rule (paraphrase) | CR § | Plan impact |
|---|---|---|---|
| First player | Random; cannot be mediated; winner does **not** choose | 5.2.1.3 | Drop `CHOOSE_ORDER` prompt; seeded coin flip only |
| Mulligan | Draw 5; starting player first, discard any number to waiting room, draw that many; once each | 5.2.1.4 | Confirms plan |
| Color requirement | Card must match color of ≥1 card in your level or clock. Exempt: level-0 characters and level-0 events only (so climaxes need color) | 8.6.2.1.1 | Was missing; now enforced |
| Level requirement | Card level ≤ cards in your level zone; climaxes exempt | 8.6.2.1.2 | Confirms |
| Clock phase | May put 1 hand card into clock; if so draw 2 | 6.4.1.2 | Confirms |
| Level up | Interrupt rule action at clock ≥7: pick 1 of bottom 7 → level, other 6 → waiting room; not during cost payment | 9.3 | Confirms; add cost-payment guard |
| Main phase moves | Swap any two of your stage positions, free; playing onto an occupied slot sends the old card to waiting room by rule action | 6.5.1.2.4, 9.6.2 | Resolves open item 13 |
| First turn | Draw not skipped. Starting player's first turn: only one attack | 6.3, 7.2.1.3.1.2 | Confirms 1-attack limit |
| Attack | Stand-state center-stage character; declaring rests it. No facing card → direct, +1 soul. Facing card → you pick frontal or side; side = −X soul, X = facing card's level | 7.2 | Confirms; facing map: my ①↔their ③, ②↔②, ③↔① (3.6.6) |
| Trigger step | Top deck card → resolution zone, run its icons, then face-down to stock | 7.3 | Confirms |
| Trigger icons | 10 actionable icons + none: soul, return, pool, comeback, draw, shot, treasure, gate, standby, choice | 4.12.2 | **Ship all 10** (rules-level, closed set), not my 6 invented names |
| Counter step | **Frontal attacks only.** Defender may play one counter-icon event or counter-icon character ability (e.g. Backup) | 7.4 | Confirms; side/direct skip it |
| Damage | Soul ≤0 deals nothing. Reveal one card at a time to resolution zone; a climax cancels all → waiting room; otherwise all → clock | 7.5, 4.10 | Confirms |
| Battle | Frontal only. Lower power reversed; tie → both reversed | 7.6 | Confirms |
| Encore | Turn player resolves own reversed chars one at a time, then non-turn player. Default ability on all characters: Encore [3 stock] → back to same slot rested | 7.7, 10.2.3 | Confirms cost 3 |
| End phase | Hand limit 7, discard extras; climax → waiting room; "until end of turn" effects end | 6.8, 3.3.3 | Confirms |
| Refresh | Deck empty → waiting room shuffled into deck, then top card → clock (not damage, can't be canceled). Mid-action draws suspend, refresh, continue | 9.2, 3.2.3.2, 4.10.2 | Refresh point is not cancellable |
| Losing | Level ≥4, or deck + waiting room both empty; both at once → draw; concede any time | 1.2, 9.4 | Add `CONCEDE` action |
| Power ≤0 | Character goes to waiting room (check rule action) | 9.5 | New rule action |
| Check timing | Rule actions first; then turn player picks and resolves one of their pending autos at a time, then non-turn player. Must play all (optional costs may be declined) | 8.5.1, 8.7.3 | Add `CHOOSE_AUTO` prompt when a player has ≥2 pending; drops my "deterministic order" deviation |
| Zone change | A card moving zones is a new card; prior effects end (stage-to-stage moves excepted) | 3.1.4 | Invariant + tests |

Out of scope for v1, with sections noted for later: markers (3.7), memory (3.12), Assist/Bond/Brainstorm/Change/Shift/Accelerate/Resonate/Fusion/Sunder/Link/Alarm/Experience/Great Performance (Sec 10), replacement effects (8.10), infinite loops (11.1), extra turns (11.2), replay command (11.3), Turn Usage Restriction (10.17).

## Definition of done (v1)
1. `npm run verify` exits 0: typecheck, lint, unit tests, `check:matrix`, `check:cards`, 2000-game fuzz, web build, Playwright e2e.
2. Every row of `docs/rules-matrix.json` is `verified|corrected|deferred|out`, none `unverified`. Each verified row cites a Comprehensive Rules section and has a test titled `[R-xxx-nn]`.
3. Fuzz: 2000 seeded games across all deck pairings, 0 invariant violations, 0 soft-locks, 0 non-terminating games, replay hash identical at every step.
4. Heuristic AI beats random bot in at least 80% of 500 seat-swapped games (threshold fixed now).
5. Hot-seat e2e proves no opponent hand/deck content in the DOM during the handoff screen.
6. The three SYN decks are legal (50 cards, max 4 copies/name, max 8 climax) and together use every ability-language feature (`npm run check:cards` enforces it).
7. Importer rejects at least 20 bad-input classes with `path` + `code`.
8. Native behavior: marked UNVERIFIED until you report the device checklist.

## Layout (new repo root)
```
src/engine/    PURE TS, zero deps: state, rules, phases, prompts, abilities, rng
src/cards/     PURE: zod schema, validator, importer, decklist parser, sets/syn-001.json
src/ai/        PURE: RandomBot, HeuristicBot (sees GameView only, never full state)
src/session/   PURE: history/undo, save envelope, normalizeSave, replay export
src/ui/        React Native screens/components; one screen reducer, no router (docs/TOOLCHAIN.md)
tests/ e2e/ scripts/ docs/ schema/ .github/workflows/ci.yml CLAUDE.md
```
Purity enforced three ways: `tsconfig.engine.json` (no DOM/RN/node types), ESLint `no-restricted-imports/properties` (no react, expo, Math.random, Date.now), and an architecture test that parses imports. No workspaces (Metro symlink risk). Tooling: Expo managed, TS strict, Vitest + fast-check for pure layers, Playwright (pinned to the installed Chromium's matching version) for web e2e. **Versions are taken from `npx expo install` at M0 and recorded in `docs/TOOLCHAIN.md`, not asserted from memory.**

## Engine design
- Immutable, JSON-serializable `GameState`; all zone moves via one `moveCard()` that asserts source (makes card conservation provable).
- API: `createGame`, `legalActions`, `validate`, `applyAction`, `projectView` (hidden-info redaction), `replay`, `checkInvariants`, `stateHash`. Illegal input returns a result, never throws.
- Actions are a closed union (`CLOCK`, `PLAY_CHARACTER`, `PLAY_EVENT`, `MOVE`, `ACTIVATE`, `PLAY_CLIMAX`, `ATTACK`, `END_PHASE`, `CONCEDE`, `ANSWER`). Legal list is stable-sorted by `actionKey`.
- Phase/step machine with auto phases; `advance()` runs until a decision is needed. Mid-effect choices use serializable frames + `Prompt` (mulligan, level-up, attack type, counter, choose-cards, choose-auto, encore, confirm). No first-player prompt (CR 5.2.1.3). Saves and replays work mid-prompt.
- Check timing follows CR 8.5.1: interrupt rule actions (refresh, level up) fire immediately; check rule actions (loss, power ≤0, illegal cards in zones) then pending autos, turn player first.
- Seeded RNG (sfc32) lives in state. Only the UI layer creates entropy. A game is replayable from `(setup, actions[])`.
- Abilities: small **declarative DSL** (data, not per-card functions). Reasons: serializable, importer can't run user code, statically validated, AI can introspect. Closed v1 set: triggers `play/attack/reversed/climaxPlayed`; timings `main/counter`; continuous power/soul; effects draw, discard, stockFromDeck, power, soul, damageOpp, salvage, lookTop, sendToWaiting, returnToHand, heal; costs stock/discard/selfToWaiting; conditions level/climax/count; keyword Backup (CR 10.5) and default Encore [3] (CR 10.2). Trigger icons are rules, not DSL: all 10 from CR 4.12.2. Everything else is deferred and listed in `docs/KNOWN_GAPS.md` and the in-app Help.

## Cards and importer
- Versioned JSON schema (`schemaVersion: 1`) generated from zod (`schema/card-set.v1.json`); drift test. Optional `art: { url }` per card, a link only, for personal card files; see docs/CARDS.md.
- `importCardSet(text)` collects up to 200 issues `{severity, code, path, message}`. Lenient mode (default): a card is played without the abilities the engine cannot run (they are listed as warnings), and a card with other errors is left out while the rest import; strict mode rejects. `parseDecklist` ("4 SYN/Y01-001") included. Details: docs/CARDS.md.
- Placeholder set `SYN` (`src/cards/sets/`): 39 original cards in three 50-card decks (yellow, red, blue), no pictures, exercising every ability feature; the fuzz tests play them. IP rules: original names and text, card text generated from DSL, no official PDF/art committed (PDF in gitignored `docs/_private/`), neutral display title + "unofficial" disclaimer.

## Card art and theme (added 2026-10-10; superseded 2026-10-17)
Superseded for card pictures: you chose the real card art for personal use (see Decisions). The repository still holds no official images or links; SYN cards have no picture. The rest of this section stands for app branding.
Decision: "Nikke theme" = a sci-fi squad *mood* with **entirely original** art and characters. No official Nikke or Bushiroad images are pulled, bundled, traced or committed (publisher artwork, not ours to redistribute).
- **Allowed (app branding):** original names, palette and generic sci-fi / armored-squad visual mood; CC0 assets only if you point me at a specific one and its license is verified from the source's own page. `SYN` cards have no picture.
- **Not allowed:** any actual Nikke character, name, logo, screenshot, or likeness; "Nikke" or "Weiss Schwarz" in the app title, bundle id, store listing or repo description (neutral display title stays); tracing or "redrawing" official cards.
- **Mechanics:** card-set format v1 has an optional `art: { url }` per card: a link, used only in your personal card files (`local-cards/` or the phone), downloaded on the phone (M5/M6). The repository holds no card images or links; `npm run check:cards` enforces it. See docs/CARDS.md.
- **Limit:** I can produce vector/procedural art, not painted illustration. Expect clean stylized silhouettes and emblems, not anime-quality portraits. If you want painted art, it needs an artist or an image source you hold rights to.
- **Done adds:** a test/script that fails if any file under `assets/` lacks a license entry; manual originality review by you at M3 and M6.

## AI
- `randomBot` drives the fuzz. `heuristicBot`: rule-of-thumb scores over the legal actions, seeded tie-breaks, no search, no peeking (test: swapping every hidden card's definition changes no decision). p95 decision under 50 ms. Plain-language account: `docs/AI.md`.

## UI
Screens: Home, Deck pick, Game board, Log (+ replay export), Rules/Help, Game over, Import. Portrait board; action tray derived only from `legalActions` (UI holds zero rule logic). Hot-seat `HandoffScreen` renders no private data; shown on every seat change (including counter step and resume from background). Counter prompts are never auto-skipped in hot-seat (skipping would leak "no counter"). Undo only while the last step is reversible and the same player acts. Save = versioned envelope + `normalizeSave` (idempotent, migration chain); incompatible saves prompt, never silently dropped. Basics: testIDs, 44pt targets, no color-only state.

## Verification
- Rules matrix + `check-matrix` script (fails on uncited, untested, unknown-id rows).
- Rule tests per area on crafted states (`buildState`), incl. refresh edge cases (during draw/damage, refresh causing level-up or loss, both zones empty).
- Fuzz invariants after every action: 100-card conservation, zone limits, one actor, no soft-lock, winner iff GAME_OVER, JSON round-trip, hidden-info redaction, legality oracle, replay hash. Fuzz finds crashes, **not wrong rules**; the matrix and your golden scenarios cover that.
- Playwright on Expo web (chromium, 390x844 and 360x640): smoke with console-error fail, hot-seat privacy, vs-AI loop, save/resume + corrupt save, importer, no horizontal overflow. Screenshots are for your review, not pixel baselines.
- Commands: `npm ci`, `typecheck`, `lint`, `test`, `test:fuzz`, `check:matrix`, `check:cards`, `build:web`, `e2e`, `verify`, `simulate`, `replay`.

## Milestones (each ends with a STOP: done / next / decision needed, then I wait for your go)
| # | Scope | Gate (evidence I show) | Size |
|---|---|---|---|
| M0 | 0A rules intake: `RULES_SOURCE.md` (v2.10 + sha256), `rules-matrix.json` (~80-120 rows, seeded from the findings table above, each citing a CR §), `KNOWN_GAPS.md` (Sec 10 keywords, markers, memory, replacement effects); you review. 0B toolchain spike: hello screen exports, serves, screenshots; CI workflow; repo `CLAUDE.md` | `npm run verify` green on hello app; matrix reviewed by you | M |
| M1 | Engine core: setup, mulligan, turn, clock/level, play, climax, win/loss, legalActions, invariants | tests + `check:matrix` green for in-scope rows | L |
| M2 | Combat, prompts, fuzz: attacks, triggers, counter, damage, refresh, battle, encore, RandomBot | 2000-game fuzz, 0 violations; refresh edge tests | L |
| M3 | Ability DSL, schema, importer, placeholder decks | `check:cards`, 20+ negative fixtures, fuzz on real decks | L |
| M4 | HeuristicBot + `simulate` | 80%+ vs random over 500 swapped games | M |
| M5 | Session layer + UI shell + handoff | e2e smoke, privacy test, screenshots for you | M |
| M6 | Full UI flow, save/resume, import UI, a11y basics, docs, device checklist | `npm run verify` green | M-L |

## Follow-ups carried between milestones
Things a milestone found but left for a later one, so they are not lost.

- **M2 (from M1 review):**
  - Build REF-03 (out of cards in the middle of damage).
  - Re-cite ZONE-31 (stock) and ZONE-41 (resolution zone order) with real combat paths.
- **M3a (done):** unplayable Encores now wait in standby instead of being dropped (ABL-11,
  ABL-12). The standby rows ABL-08, ABL-10, ABL-12 and ABL-16 are cited with card
  abilities, Encore and Shot.
- **M3b (Part A done):** CARD-23, CONC-15 and CLIMAX-04 verified in the card layer. Part B (your
  Nikke card file and the ability survey) waits for littleakiba.com network access.
- **M3c (to decide after the survey):** which missing ability features to add for the Nikke set.
- **Later (no v1 ability needs them):**
  - END-05: restarting the End Phase meets "at the end of turn" again; check CR 6.8.1.5 for
    whether abilities that already resolved may trigger again. v1 has no turn-end trigger.
  - A card being played stays in hand while an interrupt prompt is open.
  - Shot's extra damage has no source card (CR 4.11.1.2).
  - Backup picks the only defender; effects with several defenders would need a choice.
  - Play requirements read printed level, cost and color; v1 has no effect that changes them.
- **M4 (done):** the hand-limit discard is now answered one card at a time (CHOOSE_CARD), so
  its action list stays short. The computer player is described in `docs/AI.md`.
- **M5 (built):** the session layer, the screens and the hot-seat handoff. See `docs/UI.md`.
  - The seed is never shown. A save must hold it to continue a game, so saves stay on the
    device. Replays can be exported only after game over.
  - The computer player's random source comes from its own fresh entropy, never from the
    game seed. In tests and `simulate` both come from known seed names, which is fine for
    repeatable runs.
  - Saves record the card catalog's fingerprint, so a game is only continued with the cards
    it was played with. Lenient imports can leave abilities out, which shifts ability
    numbers in saved actions.
  - Undo is allowed only while the last step revealed nothing and the same player still
    decides. It restores the earlier record exactly.
  - Your web link is a preview deployment on your Vercel account, behind Vercel sign-in.
- **M6:**
  - Saving and resuming on the device. Incompatible saves get a prompt and are never dropped
    silently.
  - Loading your card file and decklists.
  - Card pictures: download on the device from the card file's links, and check the image
    host allows it. Drive links need the folder shared by link, or a signed-in phone.
  - The replay share button, the accessibility pass and the device checklist.

## Out of scope for v1
Online PvP, official data/art in the repository or the app download, full ability coverage, deckbuilder UI, memory-zone mechanics, Neo-Standard format rules, animations/sound, tutorial, replay viewer UI (export + CLI only), localization.

## Challenge
- **Assumptions:** (1) the rules PDF is complete enough to build from: yes for the base game (Sec 1-9 read in full); it does not define individual cards, so card behavior rests on our DSL; (2) Expo web export + Playwright works in this container: unproven until M0 spike; (3) Chromium on react-native-web proxies a phone: it does not (safe areas, gestures, WebKit).
- **Rules confidence now:** about 85% (`primary`) that the base-game engine matches CR v2.10 once tests pass. To raise it: your 5-10 real-game scenarios with known outcomes.
- **Counter-case:** a web-first PWA (Vite + React) would be fully testable here and deploy free via Vercel; you chose native, so I keep engine/cards/ai/session pure so any shell works. If the M0 spike fails, fall back to Vite + react-native-web with the engine untouched.
- **Top risk:** engine passes its own tests while encoding wrong rules (only the PDF, matrix review, and your golden scenarios catch it). Mitigation: M0 gate; I ask you for 5-10 real-game scenarios with known outcomes.
- **What would change my answer:** PDF unavailable (engine ships marked UNVERIFIED), or spike fails (web-first shell).

## Decisions I still need from you (non-blocking, defaults in parentheses)
Display name/branding (neutral title); lenient importer default (yes); `SessionStart` hook for `npm ci` + repo `CLAUDE.md` (yes); inert memory zone in v1 (yes); do you have a phone + Expo Go for the device checklist.

## First action after approval (mine)
Attach `weiss-scwartz-nikke`, clone it, confirm it's empty, then start M0 (rules matrix + toolchain spike). First stop: the M0 checkpoint report.
