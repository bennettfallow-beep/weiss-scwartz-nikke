# Toolchain

Versions were resolved on 2026-10-11 by `create-expo-app` (blank-typescript template) and
`EXPO_OFFLINE=1 npx expo install`, which reads the SDK's own compatibility list. They were
not taken from memory. `package-lock.json` is the exact record.

| Piece | Version | Why this one |
|---|---|---|
| Node | 22 (`.nvmrc`) | Matches the container (22.22.0) and CI |
| Expo SDK | 57 (`expo ~57.0.27`) | Latest on npm at setup |
| React Native | 0.86.3 | Pinned by SDK 57 |
| React / React DOM | 19.2.3 | Pinned by SDK 57 |
| react-native-web | ~0.21.0 | From SDK 57's bundled module list |
| TypeScript | ~6.0.3 | From the Expo template |
| Vitest | 5.0.3 | Pure-layer tests; native TS/ESM, no Babel |
| fast-check | 4.10.2 | Property tests |
| zod | 4.6.5 | Card schema and file validation (`src/cards`, scripts) |
| ESLint / typescript-eslint | 10.12 / 8.71.1 | typescript-eslint supports TS < 6.1 |
| Playwright | **exactly 1.56.1** | Must match the preinstalled Chromium build 1194 in the container |
| GitHub Actions | checkout v7, setup-node v7, upload-artifact v7 | Latest majors per each action's GitHub releases page, checked 2026-10-11 |

## Container constraints (cloud sessions)

- **Blocked hosts:** `docs.expo.dev`, `api.expo.dev`, `en.ws-tcg.com`. Expo docs cannot be read
  here, and `expo install` fails unless `EXPO_OFFLINE=1` is set. `expo export` works offline.
- **npm registry:** reachable.
- **Browsers:** Chromium only, at `/opt/pw-browsers`. Never run `playwright install` in the
  container. CI installs its own Chromium.
- **No iOS or Android simulators.** Native behavior is checked by hand with
  `docs/DEVICE_CHECKLIST.md` (written in M6).

## Decisions recorded at M0

- **No Expo Router (proposed).** The app has about six screens, no deep links and no web
  URLs to preserve. Screen state lives in one reducer, which keeps native and web behavior
  identical and the e2e hooks simple. Revisit if deep links become a requirement.
- **Web export, not the dev server, for tests.** `expo export --platform web` gives a
  static `dist/` that Playwright serves with `serve -s`, so runs are deterministic.
- **App icons:** temporary Expo template icons (MIT, see `assets/LICENSES.json`), to be
  replaced with original art.
