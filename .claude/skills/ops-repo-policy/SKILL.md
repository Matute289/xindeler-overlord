---
name: ops-repo-policy
description: Use before committing, pushing, branching, opening a PR, or writing any doc/spec/backlog entry in xindeler-overlord — the repo layout, where each document goes, and the hard rules for AI agents
---

# Repo layout & git policy — xindeler-overlord

## One repo, and what is deliberately NOT in it

| Path / thing | Where it lives | Rule |
|---|---|---|
| `/` (app source, `docs/`, `.claude/`) | `Matute289/xindeler-overlord` (`origin`, GitHub, public — renamed 2026-08-10 from `xindeler-ops-console`) | Feature branch + PR |
| The backend it talks to | `xindeler-zuul` — a **separate private repo**, `Matute289/xindeler-zuul` | Never vendored here |
| The game engine | `Matute289/xindeler-new-horizon` (sibling local checkout) | **Never edit from this repo** |
| The design/lore canon | `Matute289/xindeler-design`, nested at `xindeler-new-horizon/docs/design/` | Read-only from here; `git pull` before every read |
| Secrets (`ui_api_secret`, vLLM key, AWS creds) | `/etc/xindeler-ops/ops.env` on the VPS | **Never** in this repo, never shipped to a client |

⚠️ **This repo is public.** It is a client app: it must contain no credentials, no VPS hostnames
that are not already public, no operator UUIDs, and no private-repo design prose copied verbatim.
Reference the design spec by path; do not paste it.

## Where each document goes

| Document | Path |
|---|---|
| Design specs | `docs/specs/YYYY-MM-DD-<name>.md` |
| Reference / contracts | `docs/reference/<name>.md` |
| The backlog | `docs/backlog.md` — `OC-N` rows, single file, keep it sorted by phase |
| Runbooks (release, signing, store) | `docs/runbooks/<name>.md` |
| Ad-hoc scratch | not in git |

New work item = a new `OC-N` row in `docs/backlog.md`, appended, never renumbered. Update the
row's status in the same PR that does the work.

## Branching & PRs

- Default branch is **`development`** (changed 2026-08-09, PR #1) — every PR targets `development`,
  branch off a freshly-synced `development`. Periodically (Matías's own cadence, not every merge)
  `development` gets its own PR into `main` — same discipline as the sibling `xindeler-new-horizon`
  repo.
- Both `main` and `development` are protected: PR + 1 approval required, force-push and deletion
  blocked, `enforce_admins` OFF (Matías can bypass as repo admin if he chooses; agents never do).
- Branch names: `oc<N>/<short-slug>`, e.g. `oc7/status-screen`.
- One PR per backlog item, base `development`.
- Conventional commit subjects: `feat(oc7): ...`, `fix(oc12): ...`, `docs: ...`, `chore: ...`.

**Hard rules for AI agents — no exceptions:**

- NEVER merge or approve a PR. Open it, report the URL, stop. Only Matías merges.
- NEVER push directly to `main` or `development` (the 2026-08-09 bootstrap commit predates branch
  protection and was the one allowed exception — it cannot happen again now that both are protected).
- NEVER change branch-protection settings, repo visibility, or GitHub Actions secrets.
- NEVER commit anything under `ios/`, `android/`, `.expo/`, `node_modules/`, or any `.p8`,
  `.p12`, `.mobileprovision`, `.keystore`, `.jks`, or `google-services.json` /
  `GoogleService-Info.plist` file. See `.gitignore`; if something slips past it, that is a bug
  in `.gitignore`, not a reason to force-add.
- NEVER edit anything in `xindeler-new-horizon` or `xindeler-design` from a session rooted here.
  If the API contract needs an engine change, write it up in `docs/reference/` and say so.

## Talking to Matías

Same convention as every other Xindeler project (set 2026-06-16, applies to all projects): when
you need decisions, confirmations, or information, present a **plain-text fill-in worksheet**
inside a fenced code block — header box, numbered sections, `[Q1]`/`[Q2]` decisions with blank
`decisión:` lines, a `[DG]` global field for bulk confirmations, a final `[P1] … (SI / NO)`, and
a closing `FIN. Devolveme el bloque completado.`

The full spec and canonical example live at
`xindeler-new-horizon/docs/design/conventions/fill-in-worksheets.md`.

Respond to Matías **in Spanish**. Docs and code comments in this repo are in English.

## Async contact

If you are blocked and Matías is not around:

```bash
python /Users/mgrinberg/MyXindeler/Discord/scripts/discord_api.py notify \
  --project "xindeler-overlord" --session "<short task name>" \
  --type blocked --message "<what you need decided and why you are stuck>"
```

Types: `blocked` | `question` | `done` | `info` | `error`. Use `done` when a PR is ready too —
he is not always watching the chat.
