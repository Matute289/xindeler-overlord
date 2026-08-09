# Xindeler Ops Console — client architecture design

**Date:** 2026-08-09 · **Status:** PROPOSED — investigation + scaffolding only, no app code written.
**Origin:** Matías, 2026-08-09 — after reading the NH-75 design he overrode its §3.3 recommendation
(a responsive PWA) and asked for **real native apps for iOS and Android plus web, from one
codebase**: *"creo que ahora se usa React Native, si hay algo más actualizado que resuelve mejor —
programar una cosa y después compilar para uno o para otro SO — mejor"*, and *"grande y ambicioso…
pero está bueno y es más dedicado."*

**Companion documents**
- `xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md` (private) —
  the backend/architecture spec. **Read it first.** Everything about the game server's API surface,
  PROJECT ORACLE's real capabilities, the anti-chaos gaps and the LLM authority model carries over
  unchanged. Only its §3.3 is superseded by this document.
- `docs/reference/gateway-api-contract.md` — the HTTP/SSE contract this client assumes.
- `docs/specs/2026-08-09-restricted-distribution-plan.md` — how these apps reach exactly the people
  who should have them, and nobody else.
- `docs/backlog.md` — the `OC-N` work breakdown.

---

## 0. Executive summary

**Framework: Expo (React Native) — SDK 57, React Native 0.86, React 19.2, Expo Router, TypeScript,
with `react-native-web` for the web target.** Build and submit with EAS.

**Distribution: TestFlight *internal* testing on iOS, Play *internal testing* track on Android.**
Neither requires a public store listing; both are email-allowlisted; the iOS internal track requires
**no App Review at all**. The web build is served from the ops host behind the same gateway auth.

**Three findings decide it, in order of weight:**

1. **This app is two long-lived text streams — a log tail and an LLM chat — and `expo/fetch` is the
   only option that makes streaming identical on all three targets.** Expo's `fetch` implements
   `text/event-stream` natively and, on iOS and Android, is installed as the **global** `fetch`. So
   the SSE code you write for the browser runs unchanged on device. With bare React Native you need
   a polyfill (the default RN `fetch` does not stream — a well-known trap); with Flutter you write
   SSE twice; with Kotlin Multiplatform you lean on Ktor.
2. **The web target renders real DOM, and that matters precisely because this app is text.** Flutter
   Web and Compose Multiplatform for Web both paint into a **canvas**. The two screens this console
   exists for — a log tail and LLM output with code blocks — are things you will select, copy, and
   `Cmd+F`. Canvas makes all three second-class, and accessibility is synthesized rather than real.
   `react-native-web` renders DOM.
3. **Matías's guess was right, and "React Native" in 2026 effectively means Expo.** SDK 55 (Feb 2026)
   removed the legacy architecture entirely; SDK 56 (May) made Expo UI's SwiftUI/Jetpack Compose
   bridges stable; SDK 57 (30 Jun 2026, RN 0.86) shipped as an explicitly non-breaking follow-up.
   The 2025 State of React Native survey puts New Architecture adoption at 80% and Expo Router at
   71% of navigation share.

**Honest runner-up:** **Capacitor + a plain web app** is genuinely defensible for a 5–8-screen
internal tool and has the lowest per-OS fork of anything (~5%). See §2.4 — it is not dismissed, it
is second on a close call, and the tie-break is native feel plus EAS's credential management.

**What this costs, stated plainly:** a TypeScript/React toolchain Matías does not work in daily
(2–4 weeks to productivity from a backend/Rust background); React Native's flexbox-only layout model
with no CSS cascade; ~40 GB of Xcode and ~15 GB of Android SDK on this machine (neither installed
today); a **full fork for web push** (`expo-notifications` does not support web); and per-platform
passes for back-button semantics, safe areas and notifications that no framework removes.

---

## 1. What the client actually has to do

From NH-75 §2, re-read as *client* requirements:

| # | Capability | Client-side shape | Hard part |
|---|---|---|---|
| C1 | Start / stop / restart the server | Buttons + a live state machine | Never optimistic; Cancel must stay reachable during the drain |
| C2 | Server info | One status screen, live | Sub-second staleness matters; polling is not good enough |
| C3 | Broadcast to players | Simple form | — |
| C4 | See in-game chat | Read-only feed | Volume |
| C5 | Browse an ORACLE preset library | List + detail | — |
| C6 | Fire an ORACLE event at a place/player | Target picker → dry run → fire | The safety UX *is* the feature |
| C7 | Compose a new event by hand | Schema-driven form | Honest labelling of inert fields |
| C8 | Chat with ORACLE | Streaming chat + a draft→preview→apply card | Prompt-injection provenance |
| C9 | Do all of it from a phone | — | The whole reason we are here |

**Nothing on that list needs 3D, heavy graphics, or 60 fps animation.** It needs: fast text lists,
long-lived streaming connections, secure credential storage, good forms, and a design that is hard
to mis-tap. That profile is what drives §2 — and in particular it is why *text handling on the web
target* outranks *rendering fidelity*, which is the reverse of how most framework comparisons weigh
things.

**Non-requirements, stated so nobody builds them:** offline-first sync (an ops console offline is
useless by definition — it can only honestly say "I can't reach the server"), multi-tenant accounts,
app-store discoverability, localization beyond es/en, and any in-app purchase.

---

## 2. Framework comparison

### 2.0 ⚠️ Two store deadlines constrain every candidate

- **Apple:** since **2026-04-28**, every upload to App Store Connect must be built with **Xcode 26 /
  iOS 26 SDK** or later. No exceptions.
- **Google Play:** from **2026-08-31** (three weeks from this spec's date), new apps and updates must
  target **Android 16 / API 36**. An extension can be requested until 2026-11-01.

This is not a footnote — it disqualifies frameworks with slow or community-maintained release
cadences. Expo SDK 57, Capacitor 8.5, Flutter 3.44 and Compose MP 1.11 are all current. Tauri's
mobile track, Lynx and Dioxus are not reliably there.

### 2.1 The candidates, as of 2026-08

| | Expo / React Native | Capacitor / Ionic | Flutter | Compose MP (KMP) | Tauri 2 | .NET MAUI | Plain PWA |
|---|---|---|---|---|---|---|---|
| **Current stable** | Expo SDK 57 (30 Jun 2026), RN 0.86 | Capacitor 8.5 (31 Jul 2026) | 3.44 (18 May 2026) | CMP 1.11.1 | 2.11.5 | .NET 10 | — |
| **Web target** | first-class | **is** web | production-viable | **Beta** (official) | n/a (front is web) | none (separate Blazor app) | native |
| **Web rendering** | **real DOM** | **real DOM** | canvas (canvaskit/skwasm, ~1.5–2 MB) | canvas (Skiko) | DOM | DOM | DOM |
| **Select / Cmd+F / a11y on web** | ✅ | ✅ | ⚠️ poor | ⚠️ poorest | ✅ | ✅ | ✅ |
| **SSE story** | **`expo/fetch`, global on native** | browser APIs, free | Dart has no `EventSource`; packages | Ktor (good types) | browser APIs | — | free |
| **Secure storage / biometrics / push** | official Expo modules (no web push) | official Capacitor plugins | Firebase (incl. **web push**) | community only (no official Firebase) | thin on mobile | ok | no Keychain; WebAuthn |
| **Managed cloud build** | **EAS Build + Submit** | none (Appflow winding down) | Codemagic/Bitrise | none | none | — | n/a |
| **Realistic per-OS fork** | ~10–20% | **~5%** | low UI, medium capability | medium-high | high on mobile | medium | 0% |
| **Language** | TypeScript | TypeScript | Dart | Kotlin | Rust + web | C# | TypeScript |
| **Curve from backend/Rust** | medium-high | **low** | medium | medium | low lang / high mobile plumbing | high | very low |
| **Verdict** | **★ recommended** | ★ close second | strong third | premature (web) | trap | no | good baseline |

### 2.2 Why Expo wins

1. **Streaming, written once.** `expo/fetch` (available since SDK 52) is a WinterCG-compliant
   `fetch` with real `text/event-stream` support, installed as the global `fetch` on iOS and
   Android. The log tail and the ORACLE chat — the two things this app *is* — use identical code on
   all three platforms. Nothing else in the comparison offers that.
2. **DOM on web.** See §0.2. This is the requirement most comparisons under-weight and this app
   over-weights.
3. **EAS Build / EAS Submit.** The value is not "avoid Xcode" (Xcode will be installed anyway) — it
   is that **EAS manages signing certificates and provisioning profiles**, which is where a solo dev
   actually loses days. Free tier: 30 builds/month (15 iOS + 15 Android), 45-minute timeout; the
   Starter plan is USD 19/month for a 2-hour timeout. For a ~8-screen app the free tier is enough.
4. **Largest ecosystem of the candidates** for the mundane parts: `expo-secure-store`,
   `expo-local-authentication`, `expo-notifications`, `expo-background-task`, list virtualization,
   markdown rendering, form libraries.
5. **Already compliant** with Xcode 26 / iOS 26 SDK and API 36.
6. **WebStorm is already Matías's IDE**, and TypeScript's structural types and discriminated unions
   read naturally coming from Rust.

### 2.3 What Expo costs — the honest list

- **The learning curve is real and it is not "learn React".** It is React *plus* React Native's
  layout model: flexbox only, no CSS cascade, no `position: fixed`, unitless numbers, and a
  `react-native-web` subset of web behaviour. Budget 2–4 weeks to productivity. **NativeWind**
  (Tailwind-style classes, 42% styling share in the 2025 survey) meaningfully shortens this and is
  recommended over raw `StyleSheet`.
- **`expo-notifications` does not support web.** Web push is a separate implementation (service
  worker + VAPID). This is a genuine fork, not a shim. It is why push is Phase 6 (OC-45).
- **`expo-secure-store` does not support web** either — web uses an `HttpOnly` cookie from the
  gateway. Design the auth module with two backends from day one (§5.3).
- **Metro is slower than Vite**, and annual SDK upgrades occasionally hurt (though 56→57 was
  explicitly non-breaking).
- **Expo SSR is still alpha** (SDK 55+). Irrelevant here — this app uses static rendering, and
  everything is behind auth so SEO does not exist — but keep it off the critical path.

### 2.4 Capacitor — the runner-up, and when it would be the right call

If the priority were *ship with the least new technology*, Capacitor wins. It is a plain web app
(any framework, or none) wrapped for iOS and Android. SSE and WebSocket are browser APIs, so
streaming is free. Secure storage, biometrics and push all have official plugins. **The per-OS fork
is the lowest of anything here — around 5%, all behind one `Capacitor.isNativePlatform()` check.**
Capacitor 8.5 shipped 31 Jul 2026 with the iOS 27 `UIScene` migration pulled forward from v9 at
community request, which is a healthy sign.

What tips it to second place:

- **It will not feel native.** Scroll momentum, transitions, keyboard behaviour. For a tool used at
  2 a.m. on a phone this is a real, if soft, cost.
- **No managed build service.** OutSystems has discontinued Ionic's *commercial* products (the OSS
  framework and Capacitor continue, maintained), which takes Appflow off the table. You would run
  GitHub Actions on macOS runners and manage signing yourself — precisely the work EAS removes.
- **Non-zero App Review risk** under Guideline 4.2 for "a website in a wrapper". Mitigated here by
  going TestFlight-internal-only, which skips review entirely — so this risk is smaller for *this*
  project than for most.
- Background execution is weak (the webview suspends).

**Choose Capacitor instead if:** Matías finds the React Native layout model genuinely painful after
a week, or if time-to-first-useful-screen matters more than long-term feel. Switching later is not
catastrophic — the API client, the schemas and the mock gateway all carry over.

### 2.5 Why the others lose

**Flutter (3.44, 18 May 2026)** is the most polished framework in the comparison, has the best
measurable momentum (1.5M monthly devs, +50% YoY), the lowest UI fork, and Dart is arguably *easier*
coming from Rust than the React ecosystem is. It loses on exactly one thing, and it is the thing
this app is made of: **Flutter Web renders to canvas.** The HTML renderer was removed; the choices
are canvaskit (~1.5–2 MB gzip before first paint) or skwasm. Text selection is emulated, browser
find-in-page does not find log lines, and accessibility goes through a synthesized semantics tree.
The Flutter community's own honest framing — "great for auth-gated SPAs, dashboards and admin
panels" — is true, but "works" is not "pleasant" when the content is long copyable text. Also note
3.44 froze Material and Cupertino in-framework ahead of moving them to separate packages: a large
architectural change worth watching. **If this app were charts and forms, Flutter would be first.**

**Kotlin Multiplatform + Compose Multiplatform (1.11.1)** is the most interesting near-miss and
Kotlin is probably the most comfortable language here for Matías (coroutines ≈ async, sealed classes
≈ enums, null-safety). iOS and Android are genuinely Stable. But **JetBrains' own stability table
lists Web (Kotlin/Wasm) as Beta for both KMP core and Compose UI**, targeting Stable at end-2026 —
several 2026 blog posts claim otherwise and are wrong; believe the official docs. Web is canvas
again, with *less* accessibility work done than Flutter. And there is **no official Firebase SDK for
KMP**, so push, secure storage and biometrics all run through community `expect/actual` wrappers
with individual maintainers on the critical path. **Revisit in early 2027.**

**Tauri 2 (2.11.5)** is the option Matías will find most tempting and the one that fits least. Its
mobile support has a stable API but not all official plugins work on mobile, and the Tauri team has
publicly acknowledged over-promising "mobile as a first-class citizen" — recent releases are almost
entirely desktop. The deeper problem: **Tauri's whole appeal is a Rust backend inside the app, and
this app's Rust backend is on the server.** A local sidecar buys nothing while costing compile
times, three distinct webview bug surfaces, missing mobile plugins, and no safety net for
push/Keychain/biometrics. Revisit only if a *desktop* ops client ever becomes a requirement — that
is Tauri's actual home turf.

**.NET MAUI / Uno Platform** — wrong language for this stack (no .NET anywhere in Matías's world),
and MAUI notably has **active Android toolchain breakage in Visual Studio 2026**. MAUI also has no
web target at all; "web" means a separate Blazor app sharing Razor components. Uno is technically
the more honest .NET answer to "one codebase including web", but same language problem plus a small
community.

**Plain PWA** — NH-75's original recommendation, and still the cheapest thing that works. iOS has
supported web push since 16.4, *but only for PWAs installed to the home screen via Safari's Share
sheet* — a step that is easy to forget and whose absence breaks push silently. There is no Keychain;
the closest equivalent is WebAuthn/passkeys, which for authenticating an operator is arguably a
*better* answer than storing a token. It is rejected only because Matías changed the requirement —
and it is worth naming what the change buys, so the cost is not paid for nothing: real push (the
"server is down" alert, the single best reason for this to be an app), Keychain/Keystore credential
storage, biometric unlock, an app-switcher presence, background stream handling, and freedom from
Safari's PWA quirks. **Note that the Expo web build is still a perfectly good web app**, so nothing
is lost by starting native.

**New entrants (2025–2026)** — **Lynx** (ByteDance, open-sourced Mar 2025; Rust toolchain, dual-thread
architecture, React bindings, targets web) is a serious bet for an experimental project but is ~18
months old with thin docs and a small community. **Valdi** (Snap, MIT, explicitly beta) is
disqualified outright: **it has no web target.** **Dioxus 0.7.3** is the one that would most appeal
to a Rust developer — React-like in Rust, sub-second hot reload, runtime hot-patching, a WGPU-based
native renderer — and it is genuinely impressive, but the mobile story is thin, there is no
store-grade tooling, and no ecosystem for push/Keychain/biometrics/background. With Xcode 26 and API
36 deadlines live, it is too much risk. **Look at it for the next project.**

### 2.6 The per-OS duplication Matías correctly expects

He is right that some behaviour must be written per platform. Realistically **10–20% of the code**,
concentrated in a thin "device capability" layer — the business UI (the ~8 screens, the log viewer,
the chat) does **not** fork. Being concrete, so it can be budgeted (backlog OC-36/OC-37):

| Thing | iOS | Android | Web |
|---|---|---|---|
| **Push** | `expo-notifications` (APNs), permission prompt | `expo-notifications` (FCM), notification **channels** | **not supported** — separate service worker + VAPID implementation |
| **Token storage** | `expo-secure-store` → Keychain | `expo-secure-store` → Keystore | `HttpOnly` cookie from the gateway |
| **Biometrics** | `expo-local-authentication` (Face ID; needs `NSFaceIDUsageDescription`) | BiometricPrompt | WebAuthn / passkeys |
| **Background work** | `expo-background-task` (aggressive suspension) | same, plus OEM Doze variance | does not exist |
| **Back navigation** | edge-swipe; no hardware back | hardware/gesture back must be handled, incl. confirm on destructive screens | browser history |
| **Safe areas** | notch / Dynamic Island / home indicator | edge-to-edge + display cutouts | none |
| **Navigation shell** | bottom tabs | bottom tabs | wide sidebar |
| **Press feedback / shadows / keyboard avoidance** | `Platform.select` | `Platform.select` | hover + focus rings |

Three tools for it, in order of preference: `Platform.select`, `.ios.tsx` / `.android.tsx` /
`.web.tsx` file extensions, and Expo UI's native SwiftUI/Compose components (stable since SDK 56)
where a genuinely platform-idiomatic control is worth it.

---

## 3. Recommendation

> **Expo SDK 57+ (React Native 0.86, React 19.2), TypeScript strict, Expo Router with static web
> rendering, EAS Build + EAS Submit, `react-native-web` for web, distributed via TestFlight internal
> + Play internal testing.**

**Adopt now:**

| Concern | Choice | Why |
|---|---|---|
| Routing | Expo Router (file-based) | one routing story across all three targets; 71% share |
| Streaming | `expo/fetch` | native `text/event-stream`, global on iOS/Android — the deciding feature |
| Server state | TanStack Query | caching, retries, invalidation; removes the need for a global store |
| Validation | zod | the gateway is a moving target; typed-but-unvalidated JSON will lie to you |
| Styling | NativeWind | shortest path from "not a frontend dev" to a consistent dark theme |
| Secrets | `expo-secure-store` (native) / `HttpOnly` cookie (web) | one interface, two backends |
| Web rendering | static rendering | everything is behind auth; SSR is alpha and unnecessary |

**Defer, deliberately:** `expo-updates` / OTA — tempting, but an ops console that can silently
change behaviour without a store record is the wrong default for a tool that can stop a production
server; revisit once there is an audit trail for it. Also defer: push (needs gateway + a separate
web implementation), and any state-management library beyond TanStack Query + React context.

**Avoid:** a component library that owns the look (NativeBase / Tamagui / gluestack-style). This app
has ~8 screens and a very specific "instrument panel" feel; a kit will fight it and add a migration
liability. Hand-write ~15 primitives on top of NativeWind.

---

## 4. Application architecture

```
xindeler-ops-console/
├── app/                      # Expo Router — file-based routes, all three platforms
│   ├── (auth)/               #   login, TOTP
│   ├── (tabs)/               #   status · players · logs · oracle · more
│   ├── oracle/               #   composer, preview, chat
│   └── _layout.tsx
├── src/
│   ├── api/                  # typed client, zod schemas, error envelope, idempotency keys
│   ├── stream/               # SSE transport: expo/fetch everywhere, one interface
│   ├── auth/                 # session store (SecureStore | cookie), step-up TOTP, refresh
│   ├── ui/                   # ~15 primitives + theme tokens; .ios/.android/.web variants
│   ├── features/             # one dir per capability (status, lifecycle, oracle, chat)
│   └── config/               # environment profiles (mock / wireguard / public)
├── tools/mock-gateway/       # implements docs/reference/gateway-api-contract.md
├── docs/
└── .claude/                  # skills + agents for this project
```

**Layering rule:** `features/` may import from `api/`, `stream/`, `ui/`, `auth/`. Nothing imports
from `features/` except `app/`. `ui/` imports nothing but the theme. This is the one architectural
rule worth enforcing in review, because it is the one that decays.

**State:** TanStack Query owns everything the gateway is the source of truth for. React context owns
session and config. There is no global store; if one becomes necessary, that is a signal the SSE
stream is being used wrong.

**Streaming is the spine, not a feature.** The status screen, the log tail, the lifecycle state
machine, the chat feed and the audit feed are all views over **one** SSE connection (contract §3.1).
Build that transport once, well, with reconnect/backoff and foreground-resume, and every screen
becomes a projection of it. Getting this wrong means either a 1 Hz polling app — which is exactly
what the existing Veloren `/ui` panel does, and NH-75 §1.4 rightly calls it out — or five separate
connections.

---

## 5. The parts that will actually be hard

### 5.1 The safety UX for ORACLE

The highest-consequence surface in the app, and it is a *design* problem, not a technical one.
NH-75 §5.2 documents that today's `sanitize()` clamps individual fields but has **no rate limit, no
aggregate ceiling, no cooldown, and no undo**. Server-side enforcement is being added; the app's job
is to make a bad outcome hard to reach by accident:

- Dry run is not a feature, it is the *only path* to firing. No button goes straight to a spawn.
- The preview card shows the **diff between what you asked for and what `sanitize()` will actually
  do**, so clamped hostile values are visible rather than silently absorbed.
- The target is always an explicit operator choice. Never an LLM output, never a default.
- **"There is no undo" is printed next to the fire button.** Not in a tooltip.
- The kill switch is one tap from the ORACLE tab, always.

Design the preview card so a *machine-generated* proposal (from the future autonomous World
Director) can drop into the same component. NH-75 §5.1 calls this a free win now and an expensive
retrofit later, and it is right.

### 5.2 Streaming

The trap being avoided: React Native's built-in `fetch` does not expose `response.body` as a
readable stream, so standard streaming patterns silently buffer. The classic symptom is "the log
tail only updates when the connection closes."

The fix is the reason for the framework choice: `import { fetch } from 'expo/fetch'`. On iOS and
Android it is also installed as the global `fetch`, so browser-shaped SSE code runs unchanged. Still
put it behind one `src/stream/` interface so feature code never knows, and add tests against the
mock gateway's log-flood scenario.

⚠️ Expo's dev-client CDP interceptor has historically interfered with SSE **in development only**.
If a stream works in a release build but not in dev, check that first before rewriting anything.

### 5.3 Credentials on three platforms

- Native: `expo-secure-store` → Keychain (iOS) / Keystore-backed encrypted prefs (Android). Store
  the session token only; never the password, never a TOTP secret.
- Web: `expo-secure-store` **does not support web**. The gateway sets an
  `HttpOnly; Secure; SameSite=Strict` cookie instead. The web build must **not** put a token in
  `localStorage`.
- So the auth module needs **two backends behind one interface from day one**, not as a retrofit.
- Never log a token, never put one in a crash report, never send one to a third-party SDK.

### 5.4 The WireGuard reality

NH-75 §5.3 Posture A (recommended for phases 1–3) puts the gateway on a WireGuard-only address with
no public vhost. For a mobile app this is a **first-class UX concern**: when the tunnel is off,
every request fails at the network layer. The app must detect that specific failure mode and say so
in plain language, with a deep link to the WireGuard app — not a generic error, and certainly not an
infinite spinner. Getting this wrong makes the app feel broken most of the time it is opened.

If Posture B (public `ops.xindeler.com`) is ever adopted this becomes a non-issue, but the app gains
a certificate-pinning question. Not designed here; revisit with the gateway.

---

## 6. How this client talks to the backend

Summarized; the full contract is `docs/reference/gateway-api-contract.md`, and the reasoning behind
it is NH-75 §3–§5.

- **The app never talks to the game server.** It talks only to `xindeler-ops-gateway`, the only
  component holding `ui_api_secret`, vLLM keys and AWS credentials. The game server's web port stays
  `127.0.0.1:14005` forever (NH-75 invariant 1).
- **The gateway is a separate, private repo that does not exist yet.** Every screen is therefore
  built against `tools/mock-gateway` first (backlog OC-13). That is not a workaround; it is how the
  contract gets exercised before it is expensive to change.
- **Reads:** `GET /api/v1/{status,players,logs,chat,chronicle,audit}` plus one SSE stream at
  `/api/v1/stream`.
- **Writes:** `POST /api/v1/server/{start,stop,restart,cancel_shutdown,disconnect_all}`,
  `/api/v1/broadcast`, and the ORACLE routes. All destructive writes require a TOTP step-up header
  *and* an idempotency key.
- **Errors** always arrive as `{ error: { code, message } }`; the app renders `message` verbatim so
  new gateway failure modes are legible without an app release.
- **The LLM proposes, a human applies.** The chat endpoint can only return a draft; staging and
  firing are separate, explicitly authenticated taps. This is NH-75's load-bearing invariant, and
  the client is where the user actually experiences it.

---

## 7. Distribution

Full detail in `docs/specs/2026-08-09-restricted-distribution-plan.md`. One line: **TestFlight
internal testing (iOS, 100 testers, zero App Review) + Play internal testing (Android, 100 testers,
no review, builds never expire)**, both email-allowlisted, neither publicly listed. The web build is
served from the ops host behind the same gateway auth.

---

## 8. What has to happen on this machine first

Verified 2026-08-09 on this Mac (macOS 26.5.2, arm64, ~142 GB free):

| | State | Needed |
|---|---|---|
| Node | ✅ v26.3.0, npm 11.16.0 | pin a version Expo supports in `.nvmrc` |
| Xcode | ❌ **Command Line Tools only** | **Xcode 26** (~40 GB) + iOS 26 simulator runtime + `xcodebuild -license accept`. ⚠️ Xcode 26 / iOS 26 SDK is *mandatory* for any App Store Connect upload since 2026-04-28 |
| Android SDK | ❌ not present | Android Studio + SDK **API 36** + one emulator image (~15 GB) |
| JDK | ⚠️ **26** (Homebrew) | RN's Gradle setup expects **17 or 21** — install one and pin `JAVA_HOME` per project rather than changing the system default |
| CocoaPods | ❌ absent (system Ruby 2.6) | only needed for bare/prebuild flows; EAS Build does not need it locally |
| Watchman | ❌ absent | optional, recommended for Metro file watching |
| `gh` | ✅ 2.95.0, authenticated as Matute289 | — |
| EAS account | ❌ not set up | free tier: 30 builds/month (15 iOS + 15 Android), 45-min timeout; Starter USD 19/mo raises it to 2 h |

**Xcode is not a blocker for the first build.** EAS Build compiles on hosted Macs, so OC-9 (first
TestFlight build) can happen before OC-1 completes. It *is* a blocker for simulator development and
for debugging anything native, so do it early anyway.

---

## 9. Decisions owed by Matías

These are the forks a fresh implementation session should not guess at. Present them as a fill-in
worksheet (per the project convention) before starting Phase 0.

1. **Framework: confirm Expo, or take the Capacitor off-ramp?** The recommendation is Expo, but
   §2.4 is a real alternative and the honest tie-break is "native feel + managed signing" vs "least
   new technology". This is the one decision that is expensive to reverse after Phase 1.
2. **Repo visibility.** `xindeler-ops-console` is currently **public**. It is a client app with no
   secrets, so public is defensible — but it does publish the shape of an ops tool for a live
   server. Keep public, or flip to private?
3. **Bundle identifier / app name / icon.** Recommend `dev.xindeler.opsconsole`, display name
   "Xindeler Ops". Must be fixed *before* the store records are created — renaming later means a new
   App Store Connect record.
4. **Does the gateway live in its own repo, as NH-75 §8 Q2 recommends?** If Matías would rather have
   one monorepo (`apps/console` + `services/gateway`), decide now — but note the gateway holds
   secret-adjacent code and NH-75 recommends it be private, which argues against merging it into
   this public repo.
5. **Who else gets the app, and how much do you trust them?** Just Matías, or moderators/friends
   too? Drives (a) whether the audit log needs per-operator attribution in Phase 2 rather than
   Phase 6, and (b) the iOS distribution shape — TestFlight **internal** (100 testers, zero App
   Review, but every tester needs an App Store Connect seat) vs **external** (10k testers, no ASC
   seat, but a Beta App Review per version with real Guideline 4.2 rejection risk for a
   limited-audience tool). See the distribution plan §1.3.
6. **NH-75's own open questions Q1–Q8 are still unanswered**, and Q1 (exposure posture) directly
   determines OC-12 and OC-22. This app cannot be finished without an answer to Q1.

---

## 10. Where this spec may age

- Expo SDK 58 will land on the usual cadence; the SDK numbers here are 2026-08 facts, not
  commitments.
- The Google Play API-36 deadline (2026-08-31) is three weeks out at the time of writing — verify it
  has not moved before the first Play upload.
- Compose Multiplatform's web target is targeting Stable at end-2026. If this project is revisited
  in 2027, KMP deserves a second look.
- Market-share figures for Flutter vs React Native come from third-party aggregators without
  published methodology; they are directional only and were not load-bearing in this decision.
