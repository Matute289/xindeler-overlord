# Xindeler Ops Console

A private operations app for the [Xindeler](https://github.com/Matute289/xindeler-new-horizon) game
server — **iOS, Android and web from one codebase**. Ships under the app name **Overlord**
(`com.xindeler.overlord`).

It does two things:

1. **Operate the live server** — start / stop / restart, see status, uptime, players, tick time and
   logs, broadcast a message, watch in-game chat.
2. **Drive PROJECT ORACLE** — browse a preset library of world events, compose new ones, fire them
   at a chosen player or coordinate after a dry run, and (later) chat in natural language to *draft*
   events. The model proposes; a human applies.

---

## 🚧 Status: bootstrapped, not implemented

As of **2026-08-09** this repo contains design docs, conventions and `.claude/` tooling — and **no
application code yet**. It was set up so that a fresh session can open it and start Phase 0
immediately.

| | |
|---|---|
| Framework decision | ✅ made — Expo / React Native (SDK 57), see below |
| Distribution decision | ✅ made — TestFlight internal + Play internal testing |
| Backend (`xindeler-ops-gateway`) | ❌ does not exist yet |
| App code | ❌ none |
| Local toolchain | ⚠️ incomplete — no Xcode, no Android SDK, wrong JDK |

**Start here:** [`docs/backlog.md`](docs/backlog.md) → Phase 0.

---

## The stack

**Expo (React Native) — SDK 57, RN 0.86, React 19.2 · TypeScript · Expo Router · NativeWind ·
`react-native-web` · EAS Build + Submit.**

Chosen over Flutter, Kotlin/Compose Multiplatform, Capacitor, Tauri 2, .NET MAUI and a plain PWA
for three reasons:

- **`expo/fetch` streams `text/event-stream` natively** and is the global `fetch` on iOS and
  Android. This app is essentially two long-lived text streams — a log tail and an LLM chat — so
  writing that once and having it work everywhere is the deciding feature. React Native's default
  `fetch` does not stream at all.
- **The web target renders real DOM.** Flutter Web and Compose for Web paint into a canvas, which
  makes text selection, browser find-in-page and accessibility second-class — on an app whose two
  central screens are long, copyable text.
- **EAS manages signing certificates and provisioning profiles**, which is where a solo developer
  actually loses days.

The full comparison, including the honest runner-up (Capacitor, lowest per-OS fork of anything) and
why each other candidate lost, is in
[`docs/specs/2026-08-09-client-architecture-design.md`](docs/specs/2026-08-09-client-architecture-design.md) §2.

---

## Distribution — private on purpose

This is an internal ops tool. It will **never** have a public App Store or Play listing.

- **iOS → TestFlight *internal* testing.** 100 testers, **zero App Review**, email/ASC-user
  allowlisted. Builds expire after 90 days.
- **Android → Play *internal testing* track.** 100 testers, no review, email allowlisted, builds
  never expire.
- **Web →** static export served from the ops host behind the same auth.

Apple's Enterprise Program, Ad Hoc, Custom Apps/ABM, Play unlisted apps, Firebase App Distribution
and EU alternative distribution were all evaluated and rejected — reasons recorded in
[`docs/specs/2026-08-09-restricted-distribution-plan.md`](docs/specs/2026-08-09-restricted-distribution-plan.md) §4.

---

## Architecture in one diagram

```
   App (iOS / Android / web)          ← this repo
        │  HTTPS + JSON + one SSE stream
        ▼
   xindeler-ops-gateway               ← separate private repo, not yet written
        ├── systemctl wrapper  →  xindeler-server-cli.service
        ├── 127.0.0.1:14005    →  the game server's loopback-only admin API
        ├── file writes        →  ORACLE event staging directory
        └── local vLLM + Bedrock                    ← drafts only, never applies
```

The app never talks to the game server directly and never holds a server secret. The game server's
admin port stays bound to loopback, permanently.

Client-side contract: [`docs/reference/gateway-api-contract.md`](docs/reference/gateway-api-contract.md).
Backend design (private repo): `xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md`.

---

## Safety, briefly

The app can stop a live server and spawn entities into a running world. That is only acceptable
because of a short list of invariants, all of which the UI is responsible for:

- **The LLM only ever produces a draft.** A human taps Apply, with a TOTP step-up.
- **The model never picks the target** — that is always an operator form field.
- **Dry run is the only path to firing**, and the preview shows what the server's sanitizer will
  actually change.
- **There is no undo**, and the UI says so where the decision is made.
- **No destructive action fires from a single tap**, and Cancel stays reachable throughout a
  shutdown countdown.

Full list in [`CLAUDE.md`](CLAUDE.md#the-invariants-that-are-not-negotiable).

---

## Repo layout

```
app/                     Expo Router routes (all three platforms)
src/api  src/stream  src/auth  src/ui  src/features  src/config
tools/mock-gateway/      the fake backend everything is built against
docs/backlog.md          OC-N work items, phased
docs/specs/              design docs
docs/reference/          the gateway API contract
.claude/skills|agents/   project-specific Claude Code tooling
```

## Getting started (once Phase 0 lands)

```bash
npm install
npm run mock-gateway     # in one terminal
npx expo start           # in another; press i / a / w
```

⚠️ First, `docs/backlog.md` OC-1/OC-2: this Mac has **Command Line Tools only** (no Xcode), no
Android SDK, and JDK 26 where React Native expects 17 or 21.

---

## License

Not yet chosen. Private internal tooling; treat as all-rights-reserved until decided.
