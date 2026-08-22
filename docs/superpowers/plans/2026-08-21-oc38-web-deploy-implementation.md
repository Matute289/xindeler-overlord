# OC-38 Web Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish OC-38 — produce a deployable Web export that avoids the CSP-blocking inline style
`xindeler-zuul`'s ZG-58 already flagged, add a `public` environment profile pointing at the real
deployed gateway, and add a CI job that builds and ships the export to the VPS.

**Architecture:** A custom `public/index.html` (Expo's own project-level override mechanism)
replaces the default template's inline `<style id="expo-reset">` with a linked `expo-reset.css`.
A new `public` entry joins `src/config/environments.ts`'s existing `mock`/`wireguard` profiles,
pointing at `https://zuul.xindeler.com`. A new, separate GitHub Actions workflow
(`deploy-web.yml`) exports the Web build and rsyncs it to the VPS over SSH.

**Tech Stack:** Expo's `EXPO_PUBLIC_FOLDER` convention (`public/`), GitHub Actions,
`webfactory/ssh-agent` (SSH key loading) + native `rsync`.

## Global Constraints

- No new npm dependencies.
- The deploy workflow must be a SEPARATE file from `ci.yml`, not merged into it.
- The workflow must not fail at parse/setup time if the SSH secrets are absent from repo
  settings — it's expected to be inert (fails only when it actually tries to connect) until
  Matías configures them; this is not something to code around, just don't add any check that
  would hard-fail the whole workflow file for a missing secret before the SSH step itself runs.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus real manual verification described per task.
- Design doc: `docs/specs/2026-08-21-oc38-web-deploy-design.md`.

---

## Task 1: Custom `public/index.html` + `public/expo-reset.css`

**Files:**
- Create: `public/index.html`
- Create: `public/expo-reset.css`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks in this plan — Task 3's CI workflow just runs
  `expo export --platform web`, which picks these files up automatically via Expo's own
  `EXPO_PUBLIC_FOLDER` convention (default `public`), no wiring needed.

- [ ] **Step 1: Create `public/expo-reset.css`**

```css
/* These styles make the body full-height */
html,
body {
  height: 100%;
}
/* These styles disable body scrolling if you are using <ScrollView> */
body {
  overflow: hidden;
}
/* These styles make the root element full-height */
#root {
  display: flex;
  height: 100%;
  flex: 1;
}
```

This is byte-for-byte the CSS Expo's own default template embeds inline inside
`<style id="expo-reset">` — moved to a real file so it can be linked instead of inlined.

- [ ] **Step 2: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="%LANG_ISO_CODE%">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>%WEB_TITLE%</title>
    <!-- The `react-native-web` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element
         Linked, not inlined (unlike Expo's own default template) -- xindeler-zuul's CSP (which
         serves this app's Web build, ZG-58) has no `style-src 'self' unsafe-inline'`, and Matías
         chose to keep that CSP strict rather than loosen it (OC-38 design doc). -->
    <link rel="stylesheet" href="/expo-reset.css" />
  </head>

  <body>
    <!-- Use static rendering with Expo Router to support running without JavaScript. -->
    <noscript>
      You need to enable JavaScript to run this app.
    </noscript>
    <!-- The root element for your Expo app. -->
    <div id="root"></div>
  </body>
</html>
```

`%LANG_ISO_CODE%` and `%WEB_TITLE%` are placeholders Expo's own `createTemplateHtmlAsync`
string-replaces after loading this file — keep them verbatim, do not fill them in by hand or
remove them.

- [ ] **Step 3: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors (no TypeScript touched, but confirm nothing else broke).

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean — note `.prettierignore` may or may not cover `public/*.html`/`*.css`; if
`format:check` flags either new file, run `npm run format` and re-check, don't hand-format.

- [ ] **Step 4: Real local verification — confirm Expo actually picks these files up**

Run: `npx expo export --platform web`

Then inspect the actual output (the export directory, typically `dist/`):

```bash
cat dist/index.html
```

Expected: the generated `dist/index.html` contains `<link rel="stylesheet" href="/expo-reset.css">`
(or a hashed/rewritten variant of that href — Expo may rewrite asset paths during export; confirm
whichever path it produces resolves to a real file under `dist/`) and does **not** contain
`<style id="expo-reset">`. Also confirm `dist/expo-reset.css` (or wherever the export placed it)
exists and its content matches Step 1's file. If Expo's export process didn't copy
`public/expo-reset.css` to the expected output path, investigate before moving on — this step is
the actual proof the CSP fix works, not just that the files exist in the repo.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/expo-reset.css
git commit -m "feat(oc38): custom public/index.html moves Expo's inline style reset to a linked CSS file"
```

---

## Task 2: Add the `public` environment profile

**Files:**
- Modify: `src/config/environments.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EnvironmentId` widened to include `'public'`, consumed by
  `EnvironmentContext.tsx`/`EnvironmentSwitcher.tsx`/`EnvironmentBadge.tsx` (all already generic
  over `EnvironmentId`, confirmed no code elsewhere hardcodes the two-value union — this task
  should need no changes outside this one file).

- [ ] **Step 1: Update `src/config/environments.ts`**

Current full file:

```ts
export type EnvironmentId = 'mock' | 'wireguard';

export type Environment = {
  id: EnvironmentId;
  label: string;
  baseUrl: string;
};

// Provisional: OC-13 hasn't built the real mock-gateway server yet. Adjust
// the port once it exists if it differs.
export const ENVIRONMENTS: Record<EnvironmentId, Environment> = {
  mock: {
    id: 'mock',
    label: 'Mock',
    baseUrl: 'http://localhost:4000',
  },
  wireguard: {
    id: 'wireguard',
    label: 'WireGuard',
    baseUrl: 'http://10.77.0.1:19260',
  },
};

export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = 'mock';
```

Replace with:

```ts
export type EnvironmentId = 'mock' | 'wireguard' | 'public';

export type Environment = {
  id: EnvironmentId;
  label: string;
  baseUrl: string;
};

// Provisional: OC-13 hasn't built the real mock-gateway server yet. Adjust
// the port once it exists if it differs.
export const ENVIRONMENTS: Record<EnvironmentId, Environment> = {
  mock: {
    id: 'mock',
    label: 'Mock',
    baseUrl: 'http://localhost:4000',
  },
  wireguard: {
    id: 'wireguard',
    label: 'WireGuard',
    baseUrl: 'http://10.77.0.1:19260',
  },
  // xindeler-zuul, in production (`zuul.xindeler.com`) -- also where this app's own Web build is
  // now served from (OC-38/ZG-58), same origin. Absolute URL here regardless -- keeps this entry
  // consistent with `mock`/`wireguard` above, and means this profile still works correctly even
  // if this same build is ever loaded from a different origin (e.g. a native build, or a locally
  // served copy of the Web export).
  public: {
    id: 'public',
    label: 'Público',
    baseUrl: 'https://zuul.xindeler.com',
  },
};

export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = 'mock';
```

`DEFAULT_ENVIRONMENT_ID` stays `'mock'` — do not change it. The deployed Web build still starts
on `mock` like every other build; the operator switches to `public` explicitly via
`EnvironmentSwitcher`, matching this app's existing "the active environment is always a visible,
explicit choice" convention.

- [ ] **Step 2: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors — this is the step that would catch any place still assuming a two-value
`EnvironmentId` union (a `switch` without a `default` case, for instance). If it does error
somewhere, that's a real gap this task needs to close, not something to route around.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if needed).

- [ ] **Step 3: Commit**

```bash
git add src/config/environments.ts
git commit -m "feat(oc38): add the public environment profile (zuul.xindeler.com)"
```

- [ ] **Step 4: Manual verification**

Run `npx expo start --web`, open the app in a browser, log in against the mock (`matias`/mock,
TOTP `000000`) or just check the environment switcher without logging in if that's reachable
pre-auth. Open the environment switcher (`EnvironmentSwitcher.tsx`, reached from wherever this
app's UI already exposes it — check `Más`/settings if unsure) and confirm a third option,
"Público", now appears alongside "Mock" and "WireGuard". Do not need to actually switch to it and
complete a real request (that requires the real deployed gateway and the CSP fix from Task 1 to
both be live, out of reach from this dev machine) — just confirm the option exists and is
selectable in the UI without crashing anything.

---

## Task 3: `deploy-web.yml` GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy-web.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks at the code level — this workflow runs `npx expo export
  --platform web` fresh in CI, which will naturally pick up Task 1's `public/index.html` and
  Task 2's `environments.ts` changes once those are merged, but this task's own diff doesn't
  reference either file directly.
- Produces: nothing consumed by anything else in this repo.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Deploy Web

on:
  push:
    branches: [development]
  workflow_dispatch: {}

jobs:
  deploy:
    name: export and deploy to the VPS
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - run: npm ci

      - name: Export the Web build
        run: npx expo export --platform web

      - name: Load the deploy SSH key
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.VPS_SSH_KEY }}

      - name: Sync to the VPS
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -H "${{ secrets.VPS_SSH_HOST }}" >> ~/.ssh/known_hosts
          rsync -avz --delete --safe-links \
            dist/ \
            "${{ secrets.VPS_SSH_USER }}@${{ secrets.VPS_SSH_HOST }}:/opt/xindeler-zuul/web/"
```

Notes for the implementer:
- `--delete` removes files on the VPS side that no longer exist in the fresh export (e.g. an
  old, now-unused hashed JS chunk from a previous build) — intentional, this directory should
  always mirror the latest export exactly, not accumulate stale files forever.
- `--safe-links` is the hardening ZG-58's own final review asked for (M-1: `tower-http::ServeDir`
  follows symlinks with no guard against one pointing outside the served directory) — `rsync`
  with this flag refuses to transfer any symlink whose target resolves outside the source tree,
  so this step can never introduce that risk even though the Expo export itself is not expected
  to contain symlinks in practice.
- `secrets.VPS_SSH_HOST`/`VPS_SSH_USER`/`VPS_SSH_KEY` do not exist in this repo yet — Matías adds
  them once, in this repo's GitHub Settings → Secrets and variables → Actions. Until then, this
  workflow still parses and runs (the `checkout`/`setup-node`/`npm ci`/`export` steps all succeed
  regardless), it only fails at the `ssh-agent`/`rsync` steps with an authentication/connection
  error — exactly the "inert until configured" behavior the design calls for, nothing to code
  around.
- `workflow_dispatch: {}` lets Matías trigger a deploy manually (Actions tab → this workflow →
  "Run workflow") once secrets exist, without needing a fresh push to `development` for the very
  first real deploy.

- [ ] **Step 2: Validate the YAML is well-formed**

Run: `npx js-yaml .github/workflows/deploy-web.yml` if `js-yaml` is available (check
`node_modules/.bin/js-yaml`), or a simple Python/Node one-liner to parse the file and confirm no
syntax error — this repo has no dedicated YAML linter, so a basic parse check is what "verified"
means here. If no YAML parser is conveniently available, visually double-check indentation and
that every `${{ ... }}` expression is balanced instead.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-web.yml
git commit -m "feat(oc38): add the Web export deploy workflow (inert until VPS SSH secrets are configured)"
```

- [ ] **Step 4: Note for the report, not a code step**

This task cannot be end-to-end verified without the real SSH secrets and VPS access, which this
session does not have. State this plainly in the task report — the acceptance evidence for this
task is: the workflow file is syntactically valid, its non-SSH steps (`checkout`/`setup-node`/
`npm ci`/`expo export`) are the exact same steps already proven to work in `ci.yml` and Task 1's
own manual verification, and the SSH/rsync steps are correctly configured per the design (target
path, `--safe-links`, `--delete`) even though they can't be exercised live from here.
