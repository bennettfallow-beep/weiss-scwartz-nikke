# Frontline Duel (working title)

An unofficial two-player card battler for phones that plays by the Weiss Schwarz (English
Edition) Comprehensive Rules v2.10. It uses original placeholder cards and art, has
hot-seat and vs-AI modes, and needs no server. Not affiliated with Bushiroad.

**Status:** M5 built: the screens are playable on the web build, either two players on one phone or against the computer, with the three starter decks. Card abilities run from a closed ability language. See `docs/PLAN.md` and `docs/UI.md`.

## Run it

```bash
npm ci
npm start          # Expo dev server; scan the QR code with Expo Go on a phone
npm run web        # or open it in a browser
npm run verify     # every automated check
```

## Where things are

| Path | What |
|---|---|
| `src/engine` | Rules engine: pure TypeScript, deterministic, no dependencies |
| `src/cards`, `src/ai`, `src/session` | Card data, computer player, and the session layer that runs a game for the screens |
| `src/ui` | React Native screens |
| `docs/rules-matrix.md` | Every rule, its section in the official rules, and its status |
| `docs/KNOWN_GAPS.md` | Rules the engine does not implement yet |
| `CLAUDE.md` | Commands and project rules |
