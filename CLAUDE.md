# Frontline Duel (working title)

A two-player card battler for phones: React Native + Expo, TypeScript. It plays by the
Weiss Schwarz (English Edition) Comprehensive Rules v2.10, with original placeholder
cards. Unofficial; not affiliated with Bushiroad.

## Commands

Run everything from the repo root.

```bash
npm ci                     # install exactly what package-lock.json says
npm run typecheck          # app + pure layers + node scripts/tests (3 tsconfigs)
npm run lint               # ESLint, including the purity rules
npm test                   # Vitest unit + rule tests
npm run test:fuzz          # seeded random-game fuzz (from M2)
npm run simulate           # computer player vs random: 504 seat-swapped games, >= 80% wins, p95 <= 50 ms
npm run check:matrix       # rules traceability + gate for finished milestones; -- --write regenerates docs
npm run check:cards        # SYN set legal and covers every ability feature; no official card data in git
npm run check:assets       # every file in assets/ has a license entry
npm run build:web          # expo export --platform web -> dist/
npm run e2e                # Playwright against dist/ (Chromium, phone viewports)
npm run verify             # all of the above, in order
npm run rules:sections     # rebuild docs/cr-sections.json from the private PDF
```

Adding an Expo or React Native package: `EXPO_OFFLINE=1 npx expo install <pkg>`. The
offline flag makes the CLI resolve versions from `node_modules/expo/bundledNativeModules.json`
instead of Expo's API, which this cloud container cannot reach.

## Architecture rules (enforced; do not work around)

- `src/engine` is pure TypeScript with zero dependencies. `src/cards` may also use zod.
  `src/ai` and `src/session` build on the engine. `src/ui` is the only React Native code.
- Pure layers never touch `Math.random`, `Date`, timers, globals, React, Expo or Node.
  Randomness comes only from `src/engine/core/rng.ts`, seeded from GameState.
- Other layers enter a pure layer only through its `index.ts` barrel.
- Three guards check this: `tsconfig.engine.json` (no DOM/node types), ESLint rules in
  `eslint.config.mjs`, and `tests/architecture/purity.test.ts`.
- The UI holds no rule logic. It renders the session's screen models and sends back their action
  keys. It reaches the game only through `src/session` (no engine values but `RULES_SOURCE`,
  never `game`, `seed`, `rng` or `botRng`); `tests/architecture/ui-boundary.test.ts` checks this.
- Randomness in the app comes only from `src/ui/platform/entropy.ts` (expo-crypto): separate fresh
  seeds for the game and for the computer player. `?fast=1` (web) is for tests only.

## Rules traceability

- `docs/rules-matrix.json` maps each rule to its CR section, status, milestone, implementation and tests.
- Every rule test title starts with the row id, e.g. `it('[ATK-04] side attack loses soul equal to ...')`.
- A row becomes `verified` only when `impl` lists `file#symbol` and at least one test cites it.
- `docs/rules-matrix.md` and `docs/KNOWN_GAPS.md` are generated. Never edit them by hand.
- Statements are paraphrases. The checker rejects 10+ consecutive words copied from the CR.

## IP rules

- Bushiroad's rules PDF and its extracted text live only in `docs/_private/` (gitignored).
  Never commit them or long excerpts.
- The repository holds no official card names, text, art or art links, and no Nikke or other
  franchise characters, names, logos or likenesses. Repository card art is original.
- The owner's personal card files for official sets (personal use only) live in `local-cards/`
  (gitignored) or on the device. Their card pictures are links the app downloads on the device;
  image files are never committed. `npm run check:cards` fails if official card data is tracked.
- Every file in `assets/` needs an entry in `assets/LICENSES.json`.
- App name, bundle id and store text stay neutral. No "Weiss Schwarz" or "Nikke".

## Working agreement

- Milestones M0-M6 are in `docs/PLAN.md`. Each ends with a stop and a report (done / next /
  decision needed), then waits for the owner's go.
- No "done" without a passing `npm run verify` and its output shown.
- The repository holds synthetic data only (see IP rules for personal card files). The owner does
  not write code; explain changes in plain language.
