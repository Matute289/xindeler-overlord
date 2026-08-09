---
name: ops-run
description: Use when building, running, or debugging the Xindeler Ops Console locally on iOS, Android, or web — dev server, simulators, dev clients, the mock gateway, and the environment gotchas on this Mac
---

# Running the Ops Console locally

Stack: **Expo SDK 57 (React Native 0.86, React 19.2)**, TypeScript, Expo Router, NativeWind.
Reasoning: `docs/specs/2026-08-09-client-architecture-design.md`.

## 0. Machine prerequisites (verified 2026-08-09 — several are MISSING)

| | State | Fix |
|---|---|---|
| Node | ✅ v26.3.0, npm 11.16.0 | use the version in `.nvmrc` |
| **Xcode** | ❌ **Command Line Tools only** | install **Xcode 26** from the App Store (~40 GB), then `sudo xcode-select -s /Applications/Xcode.app` and `sudo xcodebuild -license accept` |
| **Android SDK** | ❌ absent | Android Studio → SDK Manager → **API 36** + an arm64 system image |
| **JDK** | ⚠️ **26** installed (Homebrew) | RN's Gradle expects **17 or 21**. Install one and set `JAVA_HOME` for this project only — do **not** change the system default |
| Watchman | ❌ absent | `brew install watchman` (optional; helps Metro) |
| CocoaPods | ❌ absent | only needed for bare/prebuild flows |

If Xcode is not installed yet, **web and Android still work**, and EAS can produce iOS builds in the
cloud. Do not let a missing Xcode block progress on anything else.

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
