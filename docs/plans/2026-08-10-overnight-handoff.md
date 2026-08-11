# Overnight handoff — read this first if resuming cold

**If you are a fresh session picking this up: read this whole file before doing anything else.**
Matías went to sleep around 2026-08-11 (early morning AR time) and asked for autonomous work to
continue in order through the backlog, documented continuously in case the session hit its limit
mid-work. **Only one PR for all of this overnight work** — do not open multiple PRs, keep
committing to the branch below until told otherwise or until it's clearly a good stopping point.

## State right now

- **Branch:** `overnight/oc12-onward`, forked from `development` at commit `e7b37ad` (right after
  PR #14, the navigable-shell work, merged).
- **Working directory:** `~/Workspace/WebstormProjects/xindeler-overlord` — plain branch, **not** a
  worktree. No cleanup needed to resume, just `git status`/`git log` to see what's already
  committed.
- **No PR opened yet.** Don't open one until told to stop, or until you've gone as far as seems
  safe/sensible and are about to run out of clearly-scoped backlog work.

## What's already done this session (before the overnight branch)

OC-1 through OC-11 are all `✅` in `docs/backlog.md` — toolchain, scaffold, repo hygiene, CI, Apple
App Store Connect + TestFlight (installed on Matías's own iPhone), EAS project/build profiles, iOS
build+submit (done), Android build (done, but **submit blocked on OC-7** — Play Developer account
still pending Google's identity verification as of this session, no news yet per Matías), and the
navigable shell (theme + responsive 5-tab nav, NativeWind-styled). `xindeler-zuul` (the ops gateway,
separate private repo at `~/Workspace/RustroverProjects/xindeler-zuul`) was also scaffolded this
session with a full CLAUDE.md/backlog/design docs — not being worked on tonight, this session is
`xindeler-overlord` only.

**Read `docs/backlog.md` for the authoritative, up-to-date status of every OC-N item — this handoff
file is a supplement for the *in-progress* work, not a replacement for the backlog.**

## OC-12 — Environment/profile switcher — design already agreed with Matías, IN PROGRESS

**Design (approved, do not re-litigate — build it):**
- `src/config/environments.ts` — two profiles only for now: `mock` (`http://localhost:4000`,
  **provisional** — OC-13 hasn't built the real mock-gateway server yet, adjust this URL when it
  does if the actual port differs) and `wireguard` (`http://10.77.0.1:19260`, confirmed real value
  from `docs/reference/gateway-api-contract.md`). **`public` is deliberately excluded** — no
  hostname/posture decided yet for `xindeler-zuul`, don't add it.
- `src/config/EnvironmentContext.tsx` — React Context + `useEnvironment()` hook. Persisted via
  `@react-native-async-storage/async-storage` (**new dependency, not yet installed** — this is a
  non-secret preference, not a session token, so `expo-secure-store` would be the wrong tool here;
  OC-15's "never AsyncStorage" rule is specifically about auth session storage, not this). Default
  profile on first launch: **`mock`** (the safe default — never default to a real server).
- **Persistent indicator, NOT inside `Screen`** (would violate `ui/` importing only the theme) —
  lives in `app/(tabs)/_layout.tsx` as a thin strip above the `<Tabs>`/`SidebarLayout` content,
  rendered once so it's guaranteed on all 5 tabs without every future screen needing to remember it.
- `src/features/environment/EnvironmentBadge.tsx` — the persistent strip (reads `useEnvironment()`,
  shows the active profile label). Matías didn't object to making it tappable to jump to `/more`
  as a bonus — include that if cheap, skip it if it complicates things, it's optional polish not a
  hard requirement.
- `src/features/environment/EnvironmentSwitcher.tsx` — the full switcher UI, replaces the current
  placeholder content of `app/(tabs)/more.tsx` (which currently just renders `Empty` with
  "Selector de entorno y ajustes, próximamente" — that placeholder text is now live work, not
  future work).
- New `src/features/` directory doesn't exist as real code yet (only `.gitkeep`) — this is the
  first real feature module, matches `CLAUDE.md`'s stated layout.

**Status as of writing this file: design agreed, zero code written yet.** Whoever resumes should
write a short spec (`docs/specs/2026-08-10-environment-switcher-design.md`) capturing the above
(mostly transcribing this section — the design is already final), then implement directly (this is
small enough — ~6 files — that the full subagent-driven-development ceremony is probably not worth
the overhead; use judgment, but a lightweight spec + direct implementation with `npm run typecheck
&& npm run lint` verification at each step, following this repo's established commit-per-logical-
change discipline, is the intended path).

## After OC-12: continue in order per `docs/backlog.md`

Next up would be **OC-13 (mock gateway)** — a real local server implementing
`docs/reference/gateway-api-contract.md` including SSE, in `tools/mock-gateway/` (currently just
`.gitkeep`). This is a bigger, more architecturally significant piece — **if you get here, treat it
as its own brainstorm → spec → plan cycle**, don't just start writing server code. If OC-13 feels
too large to safely finish unsupervised in one go, it's fine to stop after OC-12 and open the PR —
Matías said "seguí en orden," not "finish everything," and a clean, working, reviewed OC-12 is a
perfectly good stopping point.

**Do not start anything requiring Matías's direct action** (App Store/Play Console, EAS builds,
anything touching secrets/credentials, anything in `xindeler-zuul` or the VPS) — those are
explicitly out of scope for unsupervised overnight work regardless of backlog order.

## Before opening the PR (whenever that happens)

1. `npm run typecheck && npm run lint && npm run format:check` all clean.
2. Update `docs/backlog.md` rows for whatever got done, same discipline as every other PR this
   session.
3. **Delete this file** (`docs/plans/2026-08-10-overnight-handoff.md`) as part of the final commit
   before opening the PR — it's a session-continuity aid, not a permanent doc, and its content
   (once everything's done) will be redundant with the backlog + commit history.
4. One PR, base `development`, title summarizing everything actually completed (not just OC-12 if
   more got done). Follow `ops-repo-policy` SKILL.md as always. Report the PR URL and STOP — never
   merge, per `CLAUDE.md`'s hard rule. Matías will merge it himself when he wakes up.
