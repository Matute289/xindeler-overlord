# Backlog — Xindeler Ops Console

**Convention:** `OC-N` rows, appended, never renumbered. One PR per row, branch `ocN/<slug>`.
Update the row's status in the same PR that does the work.

**Status legend:** ⬜ not started · 🔄 in progress · ✅ done · 🅿️ parked · ❌ dropped

**Phases mirror NH-75's build order** (`xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md`
§7), re-cut for a native client. Two things differ from NH-75's plan and both matter:

1. **NH-75's P0 is VPS work, not app work.** WireGuard peer, `xindeler-ops` user, the systemctl
   wrapper, `ui_api_secret` in `settings.ron` — all of that belongs to the *gateway*. This backlog
   starts at the app's own P0: toolchain + store accounts + a scaffold that runs on three targets.
2. **The gateway does not exist yet.** OC-13 (mock gateway) is therefore not optional polish — it
   is what unblocks every screen. Build it before the screens, not after.

---

## Decisions resolved

The six decisions listed in `docs/specs/2026-08-09-client-architecture-design.md` §9, answered by
Matías 2026-08-09 via the fill-in-worksheet convention:

| # | Decision | Resolution |
|---|---|---|
| 1 | Framework: Expo or the Capacitor off-ramp | Already settled before the worksheet — Expo, per Matías's original ask. Not reopened. |
| 2 | Repo visibility | **Stays public.** No secrets ever live here (enforced by `ops-safety-reviewer`); the real access boundary is the gateway's WireGuard tunnel + TOTP step-up, not client-source secrecy. Public also keeps branch protection and CI minutes free on a personal GitHub account — private would cost money for the same protections Matías wants to keep. |
| 3 | Bundle id / app name / icon | **Bundle id `com.xindeler.overlord`, display name "Overlord"** (supersedes the spec's placeholder `dev.xindeler.opsconsole` / "Xindeler Ops"). Icon: `~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png`, copied into `assets/`. |
| 4 | Gateway repo shape | Confirmed: **`xindeler-ops-gateway` is a separate, private repo**, not a monorepo package. Matches everything already assumed in this repo's docs. |
| 5 | Who else gets the app | Just Matías for now; **~2 more testers possible later**, not urgent. TestFlight *internal* track (100 testers) stays the right shape; per-operator audit attribution can stay Phase 6 (OC-28 already covers durable audit rows; per-operator attribution is cheap to add if/when a second operator actually joins — revisit then rather than now). |

NH-75's own open questions Q1–Q8 (exposure posture, etc.) are **not** resolved by this — they are a
separate, larger design question for a `xindeler-ops-gateway` design session, and directly determine
OC-12/OC-22.

---

## Phase 0 — Toolchain, accounts, scaffold

Goal: `npx expo run:ios`, `run:android` and `expo start --web` all render the same "hello" screen,
and a signed build has reached both TestFlight and Play internal testing **before any real feature
exists**. Proving the pipeline first is deliberate — the store pipeline is where the multi-day
surprises live, not the UI.

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-1 | Install **Xcode 26** + iOS 26 simulator runtimes | ✅ Done 2026-08-09. Xcode 26.6 installed, selected (`xcode-select -s /Applications/Xcode.app`) and licensed. iOS 26.5 simulator runtime installed via `xcodebuild -downloadPlatform iOS`; simulators available (iPhone 17/17 Pro/17 Pro Max/17e/Air, iPad Pro 13"/11" M5, iPad mini A17 Pro, iPad Air 13"/11" M4, iPad A16). ⚠️ **Xcode 26 / iOS 26 SDK has been mandatory for every App Store Connect upload since 2026-04-28** — this is not optional even if EAS builds in the cloud. | ✅ |
| OC-2 | Install Android Studio + SDK **API 36** + an emulator image | ✅ Done 2026-08-09 via `brew install --cask android-commandlinetools` (no Android Studio GUI needed — cmdline-tools only, `sdkmanager`/`avdmanager` on PATH). Installed: `platform-tools` 37.0.1, `platforms;android-36`, `build-tools;36.0.0`, `emulator`, `system-images;android-36;google_apis;arm64-v8a`. AVD `xindeler-ops-test` (Pixel 7) created. **JDK 17 (Temurin) installed alongside the system JDK 26** — pin `JAVA_HOME=$(/usr/libexec/java_home -v 17)` per-project, do not change the system default. SDK root: `/opt/homebrew/share/android-commandlinetools`. Play requires target API 36 for all uploads from **2026-08-31** — already covered. | ✅ |
| OC-3 | Scaffold the Expo app | Done 2026-08-09. **SDK 57.0.11** (RN 0.86.2, React 19.2.3), TypeScript strict, Expo Router, NativeWind 4.2.6 (pinned to tailwindcss 3.4.19 — v4 is not yet supported, see `ops-run` §0 gotchas), `app.config.ts` (bundle id `com.xindeler.overlord`, name "Overlord"). Three-target smoke run passed: web (`expo start --web`, HTTP 200), Android (`expo run:android` on `xindeler-ops-test`, screenshot confirmed) and iOS (`expo run:ios` on iPhone 17 Pro, screenshot confirmed). | ✅ |
| OC-4 | Repo hygiene | Done 2026-08-09. ESLint (flat config, `eslint-config-expo` + `eslint-config-prettier`), Prettier (scoped to code — docs keep their own hand-formatted conventions), `.nvmrc` pinned to `26.3.0` (already installed, satisfies RN 0.86's engines range; no separate LTS install needed). `.editorconfig` already existed from bootstrap, unchanged. ⚠️ ESLint **10.x** hits a real bug in `eslint-config-expo`'s bundled `eslint-plugin-react@7.37.5` (`context.getFilename is not a function`) — pinned to ESLint **9.39.5** until that's fixed upstream, see `ops-run` SKILL.md. GitHub Actions CI (running these on every PR) is OC-5, not this row. | ✅ |
| OC-5 | GitHub Actions CI | Done 2026-08-09. `.github/workflows/ci.yml` runs `typecheck` + `lint` + `format:check` (the same three OC-4 commands from `CLAUDE.md`'s pre-PR line) on every PR and on push to `main`/`development`. No `test` job yet — no test runner exists. `ubuntu-latest`, Node pinned via `.nvmrc`, `npm ci`. Public repo = free unlimited Actions minutes. **No store credentials or secrets used** — nothing beyond `npm ci` and the three checks. | ✅ |
| OC-6 | Apple: bundle id + App Store Connect record + TestFlight internal group | Bundle id `com.xindeler.overlord`, app name "Overlord" (decided 2026-08-09, see "Decisions resolved" above) — must match `app.config.ts`. Internal group, no App Review. See the distribution plan §2. | ⬜ |
| OC-7 | Google: Play Console app entry + internal testing track + tester list | App name "Overlord". Internal track, email allowlist. See the distribution plan §3. | ⬜ |
| OC-8 | EAS project + build profiles | `development` / `preview` / `production`; **let EAS manage signing credentials** — that is the main reason it was chosen. Free tier: 30 builds/month (15 iOS + 15 Android), 45-min timeout; Starter USD 19/mo for 2 h. Decide free-vs-paid after the first few builds. | ⬜ |
| OC-9 | **First round-trip build to both stores** | A "hello world" build installed on Matías's own iPhone via TestFlight and on an Android device via the internal track. This is the phase-0 exit criterion. | ⬜ |

---

## Phase 1 — Shell, auth, read-only console

Maps to NH-75 P1. **Zero write capability.** This alone delivers "see the server from my phone",
which is the most-used half of the ask.

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-10 | Theme + design tokens | NativeWind + ~15 hand-written primitives — **no component kit** (spec §3). Dark-first (it will be used at night, in bed), ≥44 pt tap targets, one spacing/typography scale, `prefers-color-scheme` on web. | ⬜ |
| OC-11 | Navigation skeleton | Tabs: Status · Players · Logs · ORACLE · More. Tablet/desktop gets a two-pane layout at ≥768 pt. | ⬜ |
| OC-12 | Environment/profile switcher | Base URL from config, not hardcoded. Dev / VPS-over-WireGuard / (later) public. Persisted, visible in the UI so you always know which server you are about to stop. | ⬜ |
| OC-13 | **Mock gateway** | A small local server implementing `docs/reference/gateway-api-contract.md`, incl. the SSE stream, with scripted scenarios (server down, draining, log flood, auth expiry). **Unblocks OC-14…OC-32.** Keep it in `tools/mock-gateway/`. | ⬜ |
| OC-14 | Typed API client | One module, zod (or equivalent) schemas per endpoint, the `{ error: { code, message } }` envelope rendered verbatim, `Idempotency-Key` on every mutation, timeouts, typed retries. | ⬜ |
| OC-15 | Secure session storage | `expo-secure-store` (Keychain / Keystore) on native. **Never** `AsyncStorage`. ⚠️ SecureStore has **no web support** — on web the gateway sets an `HttpOnly` cookie. Build the auth module with **two backends behind one interface from day one**, not as a retrofit. | ⬜ |
| OC-16 | Login + TOTP screens | Two-step per contract §2. Clear "session expired" handling that returns you to where you were. | ⬜ |
| OC-17 | SSE transport | `expo/fetch` — it supports `text/event-stream` natively and is the global `fetch` on iOS/Android, so one implementation covers all three targets (spec §5.2). The RN default `fetch` does **not** stream. Exponential backoff, resume-on-foreground, explicit "stream lost" banner. ⚠️ If a stream works in release but not in dev, suspect Expo's dev-client CDP interceptor before rewriting anything. | ⬜ |
| OC-18 | Status screen | The headline screen: up/down, uptime, version, players online, tick time, entity/chunk counts, pending shutdown. Live via SSE, never a 1 Hz full refresh. | ⬜ |
| OC-19 | Players screen | List + count, pull to refresh. | ⬜ |
| OC-20 | Logs screen | Virtualized list, level filter, follow-tail toggle, copy-line. Must stay smooth under a log flood — test it with the mock's flood scenario. | ⬜ |
| OC-21 | In-game chat viewer | Read-only, from `/api/v1/chat`. | ⬜ |
| OC-22 | Connectivity UX | ⚠️ Phase-1 posture is WireGuard-only. If the tunnel is down every request fails; the app must say *"no llego al gateway — ¿está la VPN prendida?"* with a deep link to the WireGuard app, not a generic spinner. | ⬜ |

---

## Phase 2 — Lifecycle control (first write capability)

Maps to NH-75 P2. **Blocked on the gateway shipping its lifecycle routes**, which is in turn
blocked on the small additive engine PR in `xindeler-new-horizon`.

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-23 | Step-up auth flow | TOTP re-prompt for destructive actions, cached for a short window, per contract §1. | ⬜ |
| OC-24 | Confirm-by-typing sheet | Type `RESTART` / `STOP` to arm. Phones in pockets press buttons. | ⬜ |
| OC-25 | Lifecycle state machine UI | `running → draining(Ns) → stopped → starting → running`, driven by the `lifecycle` SSE event, **not** an optimistic spinner. **Cancel must stay reachable during the whole drain.** | ⬜ |
| OC-26 | Start / stop / restart / disconnect-all | ⚠️ Restart is orchestrated gateway-side because `Restart=on-failure` means a graceful stop stays stopped (NH-75 §1.3). The app must not try to fake it with stop+start of its own. | ⬜ |
| OC-27 | Broadcast a message to players | With a character counter and a preview of what players will see. | ⬜ |
| OC-28 | Audit log screen | Durable gateway rows: who, when, what, outcome. This is what makes write access reviewable. | ⬜ |

---

## Phase 3 — ORACLE manual control

Maps to NH-75 P3. Highest-risk surface in the app; every safety affordance below is load-bearing,
not polish. Read NH-75 §4.3 and §5.2 before starting.

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-29 | Loaded events / templates browser | From `/oracle/events`. Show the staging lifecycle honestly (`staging… → loaded`), including parse failures, which today are only a server-side `warn!`. | ⬜ |
| OC-30 | Preset library | Browse, search, clone into the composer. Presets are **gateway data, not game assets**. | ⬜ |
| OC-31 | `DmEvent` composer form | Generated from the schema's `bounds::` constants (min/max/step), allowlists as pickers. ⚠️ `atmosphere` and `dimension_config` must render with a **"stored, not applied to the live world"** badge — the engine ignores them (NH-75 §1.5). | ⬜ |
| OC-32 | Target picker | Player picker (primary, from `/players`) + manual coordinates behind a disclosure. **The target never comes from an LLM.** A missing player is an error, never a silent fallback to the origin. | ⬜ |
| OC-33 | Dry-run preview card | Shows what *would* happen — n entities, which bodies, resolved position, distance to nearest player — **and the diff between the draft and the post-`sanitize()` value**. This is the main safety affordance in the whole app. Design it so a machine-generated proposal can drop into the same card later (NH-75 §5.1). | ⬜ |
| OC-34 | Fire + kill switch | Fire is only reachable from a dry-run card. Kill switch prominent. ⚠️ **"There is no undo" must be printed next to the fire button** — it is the honest state of the engine. | ⬜ |

---

## Phase 4 — Hardening & the real second platform

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-35 | Tablet / iPad layouts | Two-pane master-detail, keyboard shortcuts on web, orientation handling. Matías tests on iPad. | ⬜ |
| OC-36 | Android-specific pass | Back-button semantics, notification channels, edge-to-edge insets, Material ripple vs iOS press states. This is the "duplicate behaviour per OS" reality — budget for it explicitly. | ⬜ |
| OC-37 | iOS-specific pass | Safe areas incl. Dynamic Island, swipe-back gesture vs custom headers, background/foreground stream resume, Face ID gate (optional). | ⬜ |
| OC-38 | Web deploy | Static export served by the gateway (or nginx) at the ops host. Same code, no separate app. | ⬜ |
| OC-39 | Error/telemetry | Crash + error reporting that does **not** phone home to a third party with ops data — prefer logging to the gateway. Decide explicitly rather than defaulting to Sentry. | ⬜ |
| OC-40 | E2E smoke on device | Maestro (or equivalent) run against the mock gateway, in CI where possible. | ⬜ |

---

## Phase 5 — Chat with ORACLE

Maps to NH-75 P5. Gateway-side work dominates; the app's job is the chat surface and reusing the
OC-33 preview card.

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-41 | Chat UI with token streaming | Reuses the OC-17 SSE transport. Thread list, retry, copy. | ⬜ |
| OC-42 | Draft → preview → apply | The draft lands in the **same** OC-33 card. **The model's output is only ever a draft; a human taps Apply.** That single invariant is what makes this safe to ship. | ⬜ |
| OC-43 | Tier switch + budget | Local vLLM by default, a visible "think harder" (Bedrock) button labelled with month-to-date spend from `/oracle/budget`. | ⬜ |
| OC-44 | Untrusted-content affordances | Player chat and aliases quoted into prompts are untrusted. Show provenance in the UI so the operator can see what the model was fed (NH-75 §5.4). | ⬜ |

---

## Phase 6 — Later / opportunistic

| ID | Item | Notes | Status |
|---|---|---|---|
| OC-45 | Push notifications ("server is down") | Needs APNs key + FCM on the gateway. The single best reason for this to be an app rather than a PWA. ⚠️ **`expo-notifications` does not support web** — web push is a separate service-worker + VAPID implementation. Budget it as two jobs, not one. | 🅿️ |
| OC-46 | Biometric unlock | `expo-local-authentication` (Face ID / BiometricPrompt) to reopen a live session instead of retyping TOTP. No web support — web equivalent is WebAuthn/passkeys, which is arguably the better answer there. | 🅿️ |
| OC-47 | Widget / Live Activity | iOS: server status on the lock screen. Expo UI's SwiftUI APIs went stable in SDK 56. Pure delight, zero necessity. | 🅿️ |
| OC-48 | Add a second operator | Multi-operator support once a moderator needs access — tester allowlists, audit attribution. | 🅿️ |
| OC-49 | World Director approval queue | Reuse the OC-33 card as the `PROPOSED → VALIDATED` human step for the autonomous director (NH-75 §5.1). | 🅿️ |

---

## Known blockers & dependencies

| Blocker | Blocks | Owner |
|---|---|---|
| `xindeler-ops-gateway` repo does not exist | Everything past OC-13 against a real backend | Matías / a separate session |
| NH-75's open questions Q1–Q8 unanswered | Exposure posture (Q1) directly shapes OC-12 and OC-22 | Matías |
| The additive engine PRs (NH-75 §3.2) | Phase 2 and Phase 3 | `xindeler-new-horizon` |
| Apple/Google/EAS accounts not set up (OC-6–OC-8) | OC-9, the Phase-0 exit criterion | Matías, at the consoles |

Xcode and the Android SDK (the old OC-1/OC-2 blockers) are resolved — see `.claude/skills/ops-run/SKILL.md`
§0 for current toolchain state. **The six Phase-0 design decisions are resolved** too — see
"Decisions resolved" above, not the §9 worksheet in the spec (that worksheet is now historical; the
answers live in this file).
