---
name: ops-run
description: Use when building, running, or debugging the Xindeler Ops Console locally on iOS, Android, or web — dev server, simulators, dev clients, the mock gateway, and the environment gotchas on this Mac
---

# Running the Ops Console locally

Stack: **Expo SDK 57 (React Native 0.86, React 19.2)**, TypeScript, Expo Router, NativeWind.
Reasoning: `docs/specs/2026-08-09-client-architecture-design.md`.

## 0. Machine prerequisites (updated 2026-08-09 — iOS, Android and web are all ready)

| | State | Fix |
|---|---|---|
| Node | ✅ v26.3.0, npm 11.16.0 | use the version in `.nvmrc` (not yet created — OC-4) |
| **Xcode** | ✅ **26.6 installed and selected** — `xcode-select -p` → `/Applications/Xcode.app/Contents/Developer`, license accepted | — |
| **iOS simulator runtime** | ✅ **iOS 26.5 installed** — `xcrun simctl list devices available` shows iPhone 17/17 Pro/17 Pro Max/17e/Air, iPad Pro 13"/11" (M5), iPad mini (A17 Pro), iPad Air 13"/11" (M4), iPad (A16) | — |
| **Android SDK** | ✅ installed (OC-2, done) — cmdline-tools only via `brew install --cask android-commandlinetools`; `platforms;android-36`, `build-tools;36.0.0`, arm64 `system-images;android-36;google_apis;arm64-v8a`; AVD `xindeler-ops-test` (Pixel 7); SDK root `/opt/homebrew/share/android-commandlinetools` | — |
| **JDK** | ⚠️ system default is still **26** (Homebrew); **17** (Temurin) is installed alongside it | RN's Gradle expects 17 or 21. Set `JAVA_HOME=$(/usr/libexec/java_home -v 17)` for this project only — do **not** change the system default |
| Watchman | ❌ absent | `brew install watchman` (optional; helps Metro) |
| CocoaPods | ❌ absent | only needed for bare/prebuild flows |

All three targets now have their toolchain prerequisites met (OC-1 and OC-2 both done). `.nvmrc` is
pinned to `26.3.0` (OC-4) — the version already installed, which satisfies RN 0.86's own engines
range, so there was no need to install a separate "LTS" Node. Watchman and CocoaPods remain optional
and absent.

**OC-3 (the Expo scaffold) and OC-4 (repo hygiene) are both done.** Gotchas hit along the way, worth
knowing before touching styling, linting, or dependencies:

- **NativeWind 4.2.6 does not support Tailwind CSS v4** despite its loose `>3.3.0` peer range —
  `expo-doctor`'s Metro-config check throws `NativeWind only supports Tailwind CSS v3` at runtime if
  you install the v4 default. `tailwindcss` is pinned to `3.4.19` in `package.json`; don't let it
  drift to v4 until NativeWind's own docs confirm support.
- **`react-native-css-interop` (a NativeWind dependency) needs a top-level `node_modules` entry.**
  npm sometimes nests it under `node_modules/nativewind/node_modules/`, which breaks Metro's web
  bundle with `Unable to resolve module react-native-css-interop/jsx-runtime`. It's pinned as a
  direct dependency in `package.json` to force hoisting — if this error resurfaces after a dependency
  change, check `find node_modules -maxdepth 3 -iname react-native-css-interop`.
- **ESLint 10.x breaks `eslint-config-expo`'s bundled `eslint-plugin-react@7.37.5`** with
  `TypeError: contextOrFilename.getFilename is not a function` (ESLint 10 removed the deprecated
  `context.getFilename()` API that plugin still calls). `eslint` is pinned to `9.39.5` in
  `package.json` until `eslint-config-expo` ships a fixed `eslint-plugin-react` — don't bump past
  the 9.x line without checking that first.
- **Prettier is scoped to code, not docs** — `.prettierignore` excludes `*.md`. This repo's markdown
  (worksheets, tables, `.editorconfig`'s 100-col prose wrap) has its own hand-tuned conventions that
  Prettier's defaults would fight.

## 1. Install and start

```bash
npm install
npx expo start            # dev server, then press i / a / w
npx expo start --web      # web only
npx expo start --clear    # when Metro caches something stale (do this before debugging weirdness)
```

## 2. Per-target

```bash
# iOS simulator (needs Xcode)
npx expo run:ios
npx expo run:ios --device        # a physical iPhone/iPad over USB

# Android emulator or device (needs Android SDK; JAVA_HOME on 17/21)
npx expo run:android

# Web
npx expo start --web
npx expo export --platform web   # production static export
```

`run:ios` / `run:android` build a **development client** — needed for any native module beyond
what Expo Go bundles. Expo Go is only useful for the earliest scaffolding.

## 3. The mock gateway — use it, the real one does not exist

`xindeler-ops-gateway` has not been written yet. Everything in this app is developed against
`tools/mock-gateway`, which implements `docs/reference/gateway-api-contract.md` including the SSE
stream.

```bash
npm run mock-gateway            # then point the app's config profile at it
```

Scenarios it must be able to produce (they are the tests that matter): server down, server draining
with a countdown, a log flood, an auth token expiring mid-session, and the SSE stream dropping.

## 4. Environment profiles

Base URLs live in config, never hardcoded. Three profiles: `mock` (localhost), `wireguard`
(`10.77.0.1:19260`, the Phase-1 posture), and later `public`. **The active profile must be visible
in the UI** — you should never be one tap from stopping a live server you thought was the mock.

## 5. Gotchas, in the order you will hit them

| Symptom | Cause / fix |
|---|---|
| SSE works in a release build, not in dev | Expo's dev-client CDP interceptor has historically interfered with `text/event-stream`. Check this **before** rewriting the transport |
| Log tail only updates when the connection closes | Something is using the default RN `fetch` instead of `expo/fetch`. The default does not stream |
| Gradle fails with a cryptic JVM error | `JAVA_HOME` is pointing at JDK 26. Point it at 17 or 21 |
| `xcodebuild requires Xcode` | Command Line Tools only — see §0 |
| Styles work on web, not on native | RN is flexbox-only: no CSS cascade, no `position: fixed`, unitless numbers. Not a bug |
| Metro serving stale code | `npx expo start --clear` |
| Native module missing in Expo Go | You need a development build (`expo run:*` or `eas build --profile development`) |

## 6. Checks before opening a PR

```bash
npx tsc --noEmit
npm run lint
npm test
```

Run the app on **at least two** of the three targets for any UI change. Platform-conditional code is
~10–20% of this app by design; a change that looks right on web is not verified.
