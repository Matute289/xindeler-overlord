# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## What this repo is

`xindeler-ops-console` is the **client app** for operating the live Xindeler game server from a
phone, tablet, or browser: start/stop/restart the server, see status and players and logs, and —
later — talk to PROJECT ORACLE to draft and fire world events.

It exists because of a decision Matías made on **2026-08-09**: after reading the NH-75 design (which
recommended a responsive PWA), he asked instead for **real native apps for iOS and Android plus
web, from one codebase**. He has Apple Developer and Google Play accounts and this is a Mac, so the
native path is open.

**Status: Phase 0 in progress.** As of 2026-08-09 (evening) OC-1 through OC-5 are done — toolchain
ready on this machine, the Expo app scaffolded (name "Overlord", bundle id `com.xindeler.overlord`),
repo hygiene (ESLint/Prettier/`.nvmrc`) and CI all in place. **OC-6 through OC-9 remain**: the Apple/
Google/EAS account setup and the first round-trip build to both stores — these need Matías at the
consoles, not solo Claude work. **Read `docs/backlog.md` for the live status before doing anything
else** — it is kept current after every merged PR and is the source of truth for exactly where to
pick up.

### The three repos in play

| Repo | Where | What |
|---|---|---|
| **`xindeler-ops-console`** (this one) | `Matute289/xindeler-ops-console`, **public** | The client app: iOS + Android + web |
| **`xindeler-ops-gateway`** | **does not exist yet**; will be its **own separate private repo** on GitHub (confirmed by Matías 2026-08-09, private for security — it holds `ui_api_secret`, vLLM/Bedrock keys, and operator sessions) | The backend this app talks to. Holds every secret. Also owns systemd control, ORACLE staging, and the LLM calls. **No owner/session has claimed creating it yet** — if you're picking up gateway work, check first whether it already exists before assuming you're starting from scratch |
| **`xindeler-new-horizon`** | sibling local checkout at `~/Workspace/RustroverProjects/xindeler-new-horizon` | The Veloren-derived Rust game engine + server. **Never edit it from a session rooted here.** Its private design repo is nested at `docs/design/` |

**Read the backend design before writing anything that talks to a server:**
`xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md` (private repo
`Matute289/xindeler-design`). ⚠️ Matías works in `docs/design/` concurrently — run `git status` and
`git pull` **inside that directory before every read**, and never commit anything there from a
session rooted in this repo.

## Chosen stack, and why

**Expo (React Native) — SDK 57, RN 0.86, React 19.2, TypeScript strict, Expo Router, NativeWind,
`react-native-web`, EAS Build + Submit.**

Three reasons, in order of weight (full comparison in
`docs/specs/2026-08-09-client-architecture-design.md` §2):

1. **`expo/fetch` supports `text/event-stream` natively and is the global `fetch` on iOS/Android.**
   This app is two long-lived text streams — a log tail and an LLM chat — so streaming written once
   and running everywhere is the deciding feature. The default React Native `fetch` does **not**
   stream.
2. **`react-native-web` renders real DOM.** Flutter Web and Compose Multiplatform for Web paint into
   a canvas, which makes text selection, `Cmd+F` and accessibility second-class — on an app whose
   two central screens are long copyable text.
3. **EAS manages signing certificates and provisioning profiles**, which is where a solo developer
   actually loses days.

The honest runner-up was **Capacitor + a plain web app** (lowest per-OS fork of anything, ~5%). It
is documented in §2.4, not dismissed. Flutter, Kotlin Multiplatform, Tauri 2, .NET MAUI, Lynx,
Valdi and Dioxus were all evaluated and rejected for reasons recorded in §2.5 — **do not re-open
the framework question without reading it.**

## Repo layout

```
├── app/                     # Expo Router file-based routes (all three platforms)
├── src/
│   ├── api/                 # typed client, zod schemas, error envelope, idempotency keys
│   ├── stream/              # the single SSE transport
│   ├── auth/                # session storage (SecureStore native / cookie web), TOTP step-up
│   ├── ui/                  # ~15 primitives + theme; imports nothing but the theme
│   ├── features/            # status, lifecycle, oracle, chat
│   └── config/              # environment profiles (mock / wireguard / public)
├── tools/mock-gateway/      # implements the gateway contract — the real gateway does not exist yet
├── docs/
│   ├── backlog.md           # OC-N work items, phased. Read on resume, update as you go
│   ├── specs/               # design docs
│   └── reference/           # the gateway API contract
└── .claude/{skills,agents}/
```

**Layering rule (the one worth enforcing in review):** `features/` may import `api/`, `stream/`,
`ui/`, `auth/`. Nothing imports `features/` except `app/`. `ui/` imports only the theme.

## Commands

```bash
npm install
npx expo start                   # dev server; press i / a / w
npx expo run:ios                 # iOS dev client (needs Xcode 26)
npx expo run:android             # Android dev client (needs Android SDK, JDK 17 or 21)
npx expo start --web
npx expo export --platform web   # production web export
npm run mock-gateway             # the fake backend everything is built against

npm run typecheck && npm run lint && npm run format:check    # before every PR (no test runner yet)
```

✅ **This machine is ready for all three targets** (updated 2026-08-09, OC-1 and OC-2 both done):
Xcode 26.6 installed and selected (license accepted), iOS 26.5 simulator runtime installed. Android
SDK installed via `brew install --cask android-commandlinetools` — `platforms;android-36`,
`build-tools;36.0.0`, an arm64 emulator image, AVD `xindeler-ops-test`. JDK 17 (Temurin) is installed
alongside the system JDK 26 — pin `JAVA_HOME=$(/usr/libexec/java_home -v 17)` **per project only**,
never change the system default. See `docs/backlog.md` OC-1/OC-2 and
`.claude/skills/ops-run/SKILL.md` §0 for the remaining optional gaps (watchman, CocoaPods).

## The invariants that are not negotiable

This app can stop a live game server and inject entities into a running world, partly on an LLM's
suggestion. These come from NH-75 §9 and are enforced in *this* codebase:

1. **The LLM only ever produces a draft.** No code path lets a chat response stage or fire anything.
   A human taps Apply, with TOTP step-up.
2. **The model never chooses the target.** `target` is an operator form field; drafts carry no
   target. This is what defeats prompt injection through player chat.
3. **Dry run is the only path to firing.** The preview card diffs the draft against the
   post-`sanitize()` value so clamped values are visible.
4. **There is no undo**, and the UI says so at the point of decision.
5. **No destructive action fires from a single tap** — confirm-by-typing plus step-up — and
   **Cancel stays reachable for the entire draining window.**
6. Lifecycle state comes from the SSE stream, never from optimistic local state. The client never
   fakes a restart with its own stop-then-start.
7. The app never holds `ui_api_secret`, vLLM keys, or AWS credentials. If a feature seems to need
   one, it belongs in the gateway.
8. **The UI never implies a capability the engine lacks** — `atmosphere`/`dimension_config` are
   parsed and stored but never applied and must say so; "adventures" are ordered preset folders,
   not a quest system.

`.claude/agents/ops-safety-reviewer.md` exists to check these on every relevant diff. Run it.

## Git & PR policy

- Default branch is **`development`** — every PR targets `development`, branch off a freshly-synced
  `development`. Periodically (Matías's own cadence, not every merge) `development` gets its own PR
  into `main` — same discipline as the sibling `xindeler-new-horizon` repo.
- Both `main` and `development` are protected (2026-08-09): PR + 1 approval required, force-push and
  deletion blocked, `enforce_admins` OFF (Matías can bypass as repo admin if he chooses; agents never
  do).
- Branch names `oc<N>/<slug>`; one PR per backlog item; base `development`.
- Conventional subjects: `feat(oc18): ...`, `fix(oc25): ...`, `docs: ...`, `chore: ...`.
- Update the `OC-N` row's status in the same PR that does the work.

**Hard rules for AI agents — no exceptions:**

- NEVER merge or approve a PR. Open it, report the URL, stop. Only Matías merges.
- NEVER push directly to `main` or `development` (the 2026-08-09 bootstrap commit predates branch
  protection and was the one allowed exception — it cannot happen again now that both are protected).
- NEVER change branch protection, repo visibility, or GitHub Actions secrets.
- NEVER run `eas submit` or push a build to TestFlight/Play, and never create, rotate or delete
  signing credentials or keystores, without Matías asking in the current session.
- NEVER commit signing material or secrets (see `.gitignore`). **This repo is public** — no
  hostnames beyond what is already public, no operator UUIDs, no private design prose pasted in
  verbatim.
- NEVER edit `xindeler-new-horizon` or `xindeler-design` from a session rooted here. If the API
  contract needs an engine change, write it up in `docs/reference/` and say so.

## Distribution

**TestFlight *internal* testing (iOS) + Play *internal testing* track (Android).** No public listing
on either store, ever. Both are email-allowlisted; the iOS internal track requires **no App Review
at all**. Full plan, limits, churn and the rejected alternatives (Enterprise, Ad Hoc, Custom Apps,
unlisted Play apps, Firebase App Distribution, EU alternative distribution):
`docs/specs/2026-08-09-restricted-distribution-plan.md`.

Two dates that constrain everything: **iOS uploads require Xcode 26 / iOS 26 SDK** (since
2026-04-28) and **Play uploads require target API 36** (from 2026-08-31).

## Interaction convention — fill-in worksheets

When you need Matías to make decisions, choose between options, confirm changes, or supply
information, do **not** scatter questions through prose. Present a **plain-text fill-in worksheet**
inside a fenced code block that he can complete offline and paste back whole: header box with
`=====` borders, numbered sections split by `------`, a `[DG] decisión global:` field for bulk
confirmations, real decisions as `[Q1]`/`[Q2]` each with a blank `decisión:` line, a final
`[P1] … (SI / NO)`, and a closing `FIN. Devolveme el bloque completado.`

Full spec and canonical example:
`xindeler-new-horizon/docs/design/conventions/fill-in-worksheets.md`. This is the default for any
multi-decision request; `AskUserQuestion` is only for 1–4 quick structural forks.

**Respond to Matías in Spanish.** Docs and code comments in this repo are in English; UI strings are
in Spanish.

## Async contact

If you are blocked and Matías is not around:

```bash
python /Users/mgrinberg/MyXindeler/Discord/scripts/discord_api.py notify \
  --project "xindeler-ops-console" --session "<short task name>" \
  --type blocked --message "<what you need decided and why>"
```

Types: `blocked` | `question` | `done` | `info` | `error`. Use `done` when a PR is ready — he is not
always watching the chat.

## Skills and agents in this repo

| | Use it when |
|---|---|
| `ops-run` (skill) | building/running locally on any target; the machine prerequisites and the gotchas |
| `ops-release` (skill) | cutting a build, bumping versions, TestFlight/Play submission, signing failures |
| `ops-gateway-api` (skill) | adding or changing anything that talks to the gateway |
| `ops-ui` (skill) | any screen or component; the design language and platform differences |
| `ops-repo-policy` (skill) | committing, branching, opening a PR, writing a doc |
| `mobile-code-reviewer` (agent) | reviewing a diff for Expo/RN correctness, streaming, perf, platform parity |
| `ops-safety-reviewer` (agent) | reviewing anything touching destructive actions, ORACLE, auth, or the contract |
| `release-engineer` (agent) | diagnosing build/signing/store pipeline problems |

## 📋 Backlog

**`docs/backlog.md` is the working backlog.** `OC-N` rows, phased, with the known blockers listed at
the end. **Read it on resume and before starting or after finishing any work.** Phase 0 is
toolchain + store accounts + a "hello world" that reaches both stores — deliberately, because store
pipelines are where the multi-day surprises live, not the UI.

**The six decisions from `docs/specs/2026-08-09-client-architecture-design.md` §9 were resolved by
Matías on 2026-08-09** via the fill-in-worksheet convention. Recorded in `docs/backlog.md` under
"Decisions resolved". The two load-bearing ones for any session touching app identity or CI:

- **App display name "Overlord", bundle id `com.xindeler.overlord`** (not the spec's placeholder
  `dev.xindeler.opsconsole` / "Xindeler Ops" — that recommendation was superseded). Icon at
  `~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png`, copied into `assets/`.
- **Repo stays public** — deliberate: this repo holds no secrets (enforced by
  `ops-safety-reviewer`), the real access boundary is the gateway's WireGuard/TOTP posture, and
  public keeps branch protection and CI minutes free on a personal GitHub account.
