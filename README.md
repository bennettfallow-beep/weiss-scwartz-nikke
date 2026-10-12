# Frontline Duel (working title)

An unofficial two-player card battler for phones that plays by the Weiss Schwarz (English
Edition) Comprehensive Rules v2.10. It uses original placeholder cards and art, has
hot-seat and vs-AI modes, and needs no server. Not affiliated with Bushiroad.

**Status:** M2 (combat) done. The rules engine plays complete games with no card abilities yet, and there is no game screen yet. See `docs/PLAN.md`.

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
| `src/cards`, `src/ai`, `src/session` | Card data, AI opponent, save/undo (from M1+) |
| `src/ui` | React Native screens |
| `docs/rules-matrix.md` | Every rule, its section in the official rules, and its status |
| `docs/KNOWN_GAPS.md` | Rules the engine does not implement yet |
| `CLAUDE.md` | Commands and project rules |
