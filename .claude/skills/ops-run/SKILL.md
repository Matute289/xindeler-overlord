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

## 7. Automating a real iOS Simulator (Claude-in-Chrome can't help here)

`claude-in-chrome`'s browser-automation tools only drive Chrome tabs — they cannot tap or type on a
native iOS Simulator window. `xcrun simctl` has no tap/text-input command either (screenshot/
install/launch only), and macOS Accessibility-based UI scripting (AppleScript `System Events`,
`cliclick`) is blocked for a headless/CLI process without the user granting Accessibility permission
by hand in System Settings first.

**Working method (found 2026-08-27, verifying OC-35 sub-part 2 natively):** `idb`/`idb_companion`
(Facebook's iOS Simulator control tool, already installed on this Mac) drives the simulator directly
through CoreSimulator's own APIs — no Accessibility permission needed. The installed `idb` Python CLI
(`fb-idb` 1.1.7) is broken under Python 3.14 (`asyncio.get_event_loop()` throws before argument
parsing even runs). Work around it with a one-line wrapper that pre-creates a loop:

```bash
cat > /tmp/idb.sh << 'EOF'
#!/bin/bash
python3 -c "
import asyncio, sys
asyncio.set_event_loop(asyncio.new_event_loop())
sys.argv = ['idb'] + sys.argv[1:]
from idb.cli.main import main
main()
" "$@"
EOF
chmod +x /tmp/idb.sh
```

Then, after booting a simulator normally (`xcrun simctl boot <udid>`):

```bash
/tmp/idb.sh connect <udid>
/tmp/idb.sh ui describe-all --udid <udid>        # dump the AX tree with each element's frame
/tmp/idb.sh ui tap <x> <y> --udid <udid>
/tmp/idb.sh ui text "..." --udid <udid>
/tmp/idb.sh screenshot --udid <udid> out.png
```

Sharp edges:

- **Coordinates are logical points, not screenshot pixels.** An iPhone 17 screenshot is 1206×2622px
  at 3x scale, so the point space is 402×874 — divide screenshot pixel coordinates by 3. Getting this
  wrong doesn't error, it just silently taps the wrong (or no) element. Prefer `ui describe-all` /
  `ui describe-point` for exact element frames over eyeballing a screenshot.
- **`idb ui text` with nothing actually focused doesn't error** — the physical keystrokes fall
  through to app-level keyboard shortcuts instead. In this Expo/RN dev-client app that toggled the
  "Tap something to inspect it" element inspector overlay, which survives a plain relaunch and only
  clears after a full `xcrun simctl uninstall` + reinstall. Confirm a field is actually focused
  (cursor visible in a screenshot, or `describe-point` shows the expected `AXTextField`) before
  sending `ui text`.
- **`"enabled": false` / trait `NotEnabled` in `describe-point`/`describe-all`** means the tap
  coordinates were right but the control is legitimately disabled (e.g. gated on another field being
  non-empty) — don't assume a coordinate miss.
- **`idb_companion`'s domain-socket connection drops silently sometimes** (`Connection lost` /
  `Errno 61 Connection refused` on the next call) — re-run `idb.sh connect <udid>` and retry.
- Screenshot after any tap that might open a destructive-action sheet before assuming success — a
  slightly-off tap on a "Confirmar"/"Cancelar" pair can silently hit the wrong one (or neither) and
  looks identical to "nothing happened" until you check.
- **No CLI-scriptable way to rotate the Simulator (found 2026-08-27, tablet full-screen work).**
  The Simulator app itself has a working rotate button/menu (`Hardware > Rotate Left/Right`,
  `⌘←`/`⌘→`) — a human can just click it. What's missing is a way to trigger that *without* a human:
  neither `xcrun simctl` nor `idb` has a rotate command, and AppleScript `System Events` (which
  could simulate the menu click) needs Accessibility permission granted to whatever process runs
  these shell commands, which isn't granted by default in this environment (see §7's own intro — same
  root cause as the tap/type problem this whole section solves, `idb` just doesn't cover rotation).
  If you need to see a real landscape render without a human at the keyboard, the only workaround
  found so far is a temporary edit to the *already-built app bundle's* `Info.plist`
  (`UISupportedInterfaceOrientations~ipad`) to force the orientation, reinstall, screenshot, then
  revert and reinstall again — messy, and RN `Modal` throws a harmless dev-only red box
  ("presented with 0x2 orientations mask but the application only supports 0x18") while forced this
  way, which is an artifact of the hack, not a real bug. If Accessibility permission is ever granted
  to this process, prefer scripting the real rotate menu over this hack.

## 8. Testing against a real Android emulator (AVD)

Creating a tablet-sized (or any custom-profile) AVD doesn't need a new system-image download — the
already-installed `system-images;android-36;google_apis;arm64-v8a` (see §0) works with any device
profile, since screen size is a device-profile choice independent of the image:

```bash
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager list device | grep -iB2 "pixel_tablet\|tablet"
echo "no" | $ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager create avd \
  -n xindeler-ops-tablet-test \
  -k "system-images;android-36;google_apis;arm64-v8a" \
  -d "pixel_tablet"
$ANDROID_SDK_ROOT/emulator/emulator -avd xindeler-ops-tablet-test &
```

Two gotchas found running the app against a fresh emulator (2026-08-27, tablet full-screen work):

- **The emulator's `localhost` is not the host machine's `localhost`.** `mock.baseUrl` in
  `src/config/environments.ts` is hardcoded to `http://localhost:4000`, which resolves to the
  *emulator's own* loopback, not the Mac running `npm run mock-gateway` — a well-known
  Android-emulator networking fact, not a bug in this app. Fix with a port-forward, no app changes:
  `adb reverse tcp:4000 tcp:4000`.
- **Android's autofill overlay can steal a tap during login.** The username/password fields can
  trigger a system autofill suggestion popup that intercepts the next tap instead of the field
  underneath it. If a login attempt behaves as if a tap landed somewhere else, check for this before
  assuming a coordinate/`idb`-equivalent-for-Android problem — disable autofill for the test session
  (Settings → System → Languages & input → Advanced → Autofill service → None) or dismiss the popup
  explicitly before the next tap.
