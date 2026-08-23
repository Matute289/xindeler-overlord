# Player Moderation Master-Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the online-only "Jugadores" screen with a full, paginated player-moderation
directory (online + offline accounts), add a player-detail screen with the existing account-level
flag/kick/ban/unban actions, and add two new capabilities on top: ban by email and ban by
character.

**Architecture:** A new master (`app/(tabs)/players/index.tsx`) shows a searchable, paginated
directory (`GET /players/directory`). Tapping a row navigates to a new dynamic detail route
(`app/(tabs)/players/[reference].tsx`, this app's first dynamic route) that fetches
`GET /players/{segment}` — account moderation state plus the character list in one call — and
exposes flag/kick/ban/unban actions plus the two new capabilities, all reusing the existing
`ConfirmByTypingSheet` + `useDestructiveAction` step-up pattern `StatusScreen.tsx`'s
`disconnectAll` already established. Neither new capability (ban-by-email, ban-by-character) has a
real backend yet — both are built against an *expected* request shape, clearly commented as such,
and exercised only through `tools/mock-gateway`.

**Tech Stack:** Expo Router (new dynamic route), Zod schemas, the existing `httpClient`/`useApi`
data layer, `@tanstack/react-query` (existing `usePlayersQuery`-style hooks), the existing mock
gateway (Express).

## Global Constraints

- Field names for the directory/detail/flag/kick/ban/unban schemas and calls MUST match the real,
  confirmed `xindeler-zuul` contract exactly (see `docs/specs/2026-08-23-player-moderation-master-detail-design.md`'s
  contract section) — these are not guesses, they're read from that repo's real `development`
  branch source.
- `ban_email` (on the ban request) and the two character-suspend routes/fields are **not**
  confirmed against any real backend. Every place they appear in code must carry a comment saying
  so explicitly (`// EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc`).
- Do not touch `getPlayers()`, `PlayersResponseSchema`, `Player`, or `usePlayersQuery.ts` —
  `OracleDryRunScreen.tsx` depends on all four for its own, unrelated player-targeting UI. This
  plan adds new, separate types/hooks for the directory; it does not repurpose the existing ones.
- No test runner in this repo. Verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check` (all must stay clean) plus real manual verification against
  `npm run mock-gateway` on at least two platforms (web + one native), per this repo's own
  `docs/skills/ops-run` convention.
- No new npm dependencies expected. If a task's own investigation finds one is genuinely needed,
  say so explicitly in that task's report rather than silently adding it.

---

## Task 1: Data layer — directory + detail (read side)

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/readApi.ts`
- Modify: `tools/mock-gateway/src/fixtures.js`
- Modify: `tools/mock-gateway/src/state.js`
- Create: `tools/mock-gateway/src/routes/playersDirectory.js`
- Modify: `tools/mock-gateway/server.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PlayerDirectoryRow`/`PlayerDirectoryRowSchema`, `PlayerDirectoryResponse`/
  `PlayerDirectoryResponseSchema`, `PlayerFlag`/`PlayerFlagSchema`, `CharacterSummary`/
  `CharacterSummarySchema`, `PlayerDetailResponse`/`PlayerDetailResponseSchema` (all in
  `schemas.ts`); `api.read.getPlayerDirectory(cursor?, limit?, state?)` and
  `api.read.getPlayerDetail(reference)` (in `readApi.ts`) — Tasks 3 and 4 call these directly.

- [ ] **Step 1: Add the new schemas**

In `src/api/schemas.ts`, add (near `PlayersResponseSchema`, but as fully separate exports — do not
modify `Player`/`PlayersResponseSchema` themselves):

```ts
// GET /players/directory (ZG-57/O-02) — the full account directory, online and offline, one row
// per xindeler-auth account. `reference` is opaque: never parse it, never derive anything from
// it, only ever pass it back verbatim as a path segment or as the next page's `cursor` input.
// Confirmed against xindeler-zuul's real `development` branch source (server/src/players.rs,
// `PlayerDirectoryRow`/`PlayerDirectoryResponse`) — not yet deployed to production (see that
// repo's ZG-60), but this is the real, current intended contract.
export const PlayerDirectoryRowSchema = z.object({
  reference: z.string(),
  display_username: z.string(),
  account_state: z.string(),
  online: z.boolean(),
  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  character_id: z.number().nullable(),
});
export type PlayerDirectoryRow = z.infer<typeof PlayerDirectoryRowSchema>;

export const PlayerDirectoryResponseSchema = z.object({
  players: z.array(PlayerDirectoryRowSchema),
  next_cursor: z.string().nullable(),
});
export type PlayerDirectoryResponse = z.infer<typeof PlayerDirectoryResponseSchema>;

// One row per moderation flag on an account — part of GET /players/{segment}'s `moderation.flags`.
export const PlayerFlagSchema = z.object({
  id: z.number(),
  color: z.string(),
  reason: z.string(),
  issued_by_operator_uuid: z.string(),
  issued_at: z.number(),
  decay_at: z.number().nullable(),
  ban_until: z.number().nullable(),
  revoked_at: z.number().nullable(),
  revoked_by_operator_uuid: z.string().nullable(),
});
export type PlayerFlag = z.infer<typeof PlayerFlagSchema>;

export const AdminPlayerViewSchema = z.object({
  username: z.string(),
  display_username: z.string(),
  email: z.string().nullable(),
  email_verified: z.boolean(),
  account_state: z.string(),
  flags: z.array(PlayerFlagSchema),
});
export type AdminPlayerView = z.infer<typeof AdminPlayerViewSchema>;

export const CharacterSummarySchema = z.object({
  character_id: z.number(),
  name: z.string(),
  level: z.number(),
  class: z.string(),
  location: z
    .object({
      site: z.string().nullable(),
      kingdom: z.string().nullable(),
      continent: z.string().nullable(),
    })
    .nullable(),
});
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;

export const PlayerDetailResponseSchema = z.object({
  moderation: AdminPlayerViewSchema.nullable(),
  characters: z.array(CharacterSummarySchema).nullable(),
});
export type PlayerDetailResponse = z.infer<typeof PlayerDetailResponseSchema>;
```

- [ ] **Step 2: Add the two read calls**

In `src/api/readApi.ts`, import the two new schemas alongside the existing imports and add:

```ts
    getPlayerDirectory(cursor?: string, limit?: number, state?: string) {
      const params = new URLSearchParams();
      if (cursor !== undefined) params.set('cursor', cursor);
      if (limit !== undefined) params.set('limit', String(limit));
      if (state !== undefined) params.set('state', state);
      const query = params.toString();
      return http.requestWithRetry(
        `/api/v1/players/directory${query ? `?${query}` : ''}`,
        { method: 'GET' },
        PlayerDirectoryResponseSchema,
      );
    },

    getPlayerDetail(reference: string) {
      return http.requestWithRetry(
        `/api/v1/players/${encodeURIComponent(reference)}`,
        { method: 'GET' },
        PlayerDetailResponseSchema,
      );
    },
```

`reference` is `encodeURIComponent`-ed even though it's expected to be URL-safe already — same
defensive treatment `removeOperator`'s `uuid` already gets in `writeApi.ts`, and `reference`'s
exact charset isn't part of the confirmed contract, so this costs nothing and closes a class of
bug for free.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Enrich the mock gateway's fixtures**

`tools/mock-gateway/src/fixtures.js`'s `players` array only has `alias`/`uuid` today — the
directory needs account state, characters, and at least one offline/flagged account to be a useful
fixture set. Replace the `players` array (keep the export name) with:

```js
const players = [
  {
    alias: 'Kaelith',
    uuid: '3f1b1e2a-0000-4000-8000-000000000001',
    reference: 'ref-kaelith-0001',
    account_state: 'active',
    email: 'kaelith@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 101, name: 'Kaelith', level: 12, class: 'Warrior', location: { site: 'Port Bastion', kingdom: null, continent: null } },
    ],
  },
  {
    alias: 'Voss',
    uuid: '3f1b1e2a-0000-4000-8000-000000000002',
    reference: 'ref-voss-0002',
    account_state: 'active',
    email: 'voss@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 102, name: 'Voss', level: 8, class: 'Ranger', location: null },
      { character_id: 103, name: 'Vossling', level: 3, class: 'Ranger', location: null },
    ],
  },
  {
    alias: 'Ember',
    uuid: '3f1b1e2a-0000-4000-8000-000000000003',
    reference: 'ref-ember-0003',
    account_state: 'active',
    email: 'ember@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 104, name: 'Ember', level: 20, class: 'Mage', location: { site: 'Ashfall Keep', kingdom: 'Cindral', continent: null } },
    ],
  },
  {
    alias: 'Doran',
    uuid: '3f1b1e2a-0000-4000-8000-000000000004',
    reference: 'ref-doran-0004',
    account_state: 'active',
    email: 'doran@example.com',
    email_verified: true,
    flags: [],
    characters: [],
  },
  {
    alias: 'Nyx',
    uuid: '3f1b1e2a-0000-4000-8000-000000000005',
    reference: 'ref-nyx-0005',
    account_state: 'active',
    email: 'nyx@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 105, name: 'Nyx', level: 15, class: 'Rogue', location: null },
    ],
  },
  // Offline, never connected this session — proves the directory shows accounts `GET /players`
  // (online-only) never could.
  {
    alias: 'Thistle',
    uuid: '3f1b1e2a-0000-4000-8000-000000000006',
    reference: 'ref-thistle-0006',
    account_state: 'active',
    email: 'thistle@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 106, name: 'Thistle', level: 5, class: 'Cleric', location: null },
    ],
  },
  // Already flagged + blocked — exercises the account-state badge and the flags list without
  // needing a live ban/flag action first.
  {
    alias: 'Grix',
    uuid: '3f1b1e2a-0000-4000-8000-000000000007',
    reference: 'ref-grix-0007',
    account_state: 'blocked',
    email: 'grix@example.com',
    email_verified: true,
    flags: [
      {
        id: 1,
        color: 'yellow',
        reason: 'Lenguaje inapropiado en chat global',
        issued_by_operator_uuid: '11111111-1111-4111-8111-111111111111',
        issued_at: Math.floor(Date.now() / 1000) - 86400,
        decay_at: Math.floor(Date.now() / 1000) + 86400 * 6,
        ban_until: null,
        revoked_at: null,
        revoked_by_operator_uuid: null,
      },
    ],
    characters: [
      { character_id: 107, name: 'Grix', level: 30, class: 'Warrior', location: null },
    ],
  },
];
```

Only `players` (with the fields above) is exported from this file — no other export changes.
`alias`/`uuid` stay present on every row (still consumed by `routes/players.js`'s existing
`GET /players` and `routes/oracleTrigger.js`, unaffected by this change).

- [ ] **Step 5: Add suspended-character tracking to mock state**

In `tools/mock-gateway/src/state.js`, add one field to the `state` object (near `operators`):

```js
  // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see docs/specs/2026-08-23-player-
  // moderation-master-detail-design.md. Tracks which characters are currently suspended, keyed by
  // character_id, for the mock-only ban-by-character feature (Task 2/5).
  suspendedCharacterIds: new Set(),
```

- [ ] **Step 6: Create the directory + detail mock routes**

Create `tools/mock-gateway/src/routes/playersDirectory.js`:

```js
const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');
const { sendError } = require('../errors');

const router = express.Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function toDirectoryRow(player) {
  return {
    reference: player.reference,
    display_username: player.alias,
    account_state: player.account_state,
    online: state.scenario !== 'down',
    position: null,
    character_id: player.characters[0]?.character_id ?? null,
  };
}

// `GET /players/directory?cursor=&limit=&state=` (ZG-57/O-02) — the mock has few enough fixture
// players that real cursor pagination isn't needed to exercise the UI; this always returns every
// matching row in one page (`next_cursor: null`) rather than faking a multi-page cursor scheme
// that would only ever be tested against itself.
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const stateFilter = typeof req.query.state === 'string' ? req.query.state : undefined;

  let rows = players.map(toDirectoryRow);
  if (stateFilter) {
    rows = rows.filter((row) => row.account_state === stateFilter);
  }
  res.json({ players: rows.slice(0, limit), next_cursor: null });
});

module.exports = { router, findPlayerByReference: (reference) =>
  players.find((p) => p.reference === reference) };
```

Create `tools/mock-gateway/src/routes/playerDetail.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { state } = require('../state');

const router = express.Router();

// `GET /players/{segment}` (ZG-56, extended ZG-57/O-02) — `segment` accepts either the fixture's
// `reference` or its `uuid`, matching the real gateway's own dual-accept behavior confirmed in
// `players.rs`'s `player_detail`.
router.get('/:segment', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);

  if (!player) {
    return res.json({ moderation: null, characters: null });
  }

  res.json({
    moderation: {
      username: player.alias.toLowerCase(),
      display_username: player.alias,
      email: player.email,
      email_verified: player.email_verified,
      account_state: player.account_state,
      flags: player.flags,
    },
    characters: player.characters.map((character) => ({
      ...character,
      // EXPECTED SHAPE, NOT CONFIRMED — see the design doc's ban-by-character section. The real
      // contract has no `suspended` field yet; this mock adds it so Task 5's UI has something to
      // read locally, gated behind the same in-memory Set Task 2's mutation routes update.
      suspended: state.suspendedCharacterIds.has(character.character_id),
    })),
  });
});

module.exports = router;
```

- [ ] **Step 7: Mount the two new routes**

In `tools/mock-gateway/server.js`, add near the existing `playersRoutes` requires/mounts:

```js
const playersDirectoryRoutes = require('./src/routes/playersDirectory').router;
const playerDetailRoutes = require('./src/routes/playerDetail');
```

and, **before** the existing `app.use('/api/v1/players', requireAuth, playersRoutes);` line (route
order matters — see the comment below):

```js
app.use('/api/v1/players/directory', requireAuth, playersDirectoryRoutes);
```

and **after** the existing `/players/2fa/unlock` mount (so the more specific `2fa/unlock` and
`directory` paths are matched before the catch-all `:segment` route):

```js
app.use('/api/v1/players', requireAuth, playerDetailRoutes);
```

Comment to add above these three mounts, since ordering here is load-bearing and not obvious from
reading any single line:

```js
// Order matters: /players/directory and /players/2fa/unlock must be mounted before the generic
// /players/:segment route below, or Express would match the more specific paths against :segment
// first (an Express app.use prefix match tries routers in registration order, and playersRoutes/
// playerDetailRoutes have no way to know a still-unregistered, more-specific router exists).
```

- [ ] **Step 8: Manual verification**

Run `npm run mock-gateway`, then in a separate terminal:

```bash
curl -s http://localhost:4000/api/v1/players/directory -H "Cookie: <a valid session cookie>" | jq
curl -s http://localhost:4000/api/v1/players/ref-grix-0007 -H "Cookie: <a valid session cookie>" | jq
```

(Get a valid session cookie by logging in through the app first, or by hitting `/api/v1/login`
directly with `matias`/`mock`/`000000` — same mock credentials every other manual check in this
repo already uses.)

Expected: the directory call returns 7 rows including `Grix` (`account_state: "blocked"`, one
flag) and `Thistle` (offline, no `position`); the detail call for `ref-grix-0007` returns
`moderation.flags` with one entry and `characters` with one row carrying `suspended: false`.

- [ ] **Step 9: Commit**

```bash
git add src/api/schemas.ts src/api/readApi.ts tools/mock-gateway/src/fixtures.js \
  tools/mock-gateway/src/state.js tools/mock-gateway/src/routes/playersDirectory.js \
  tools/mock-gateway/src/routes/playerDetail.js tools/mock-gateway/server.js
git commit -m "feat(oc35): player directory + detail read endpoints, schemas, and mock routes"
```

---

## Task 2: Data layer — moderation actions (write side)

**Files:**
- Modify: `src/api/writeApi.ts`
- Create: `tools/mock-gateway/src/routes/playerFlag.js`
- Create: `tools/mock-gateway/src/routes/playerKick.js`
- Create: `tools/mock-gateway/src/routes/playerBan.js`
- Create: `tools/mock-gateway/src/routes/playerUnban.js`
- Create: `tools/mock-gateway/src/routes/playerCharacterSuspend.js`
- Modify: `tools/mock-gateway/server.js`

**Interfaces:**
- Consumes: `players` fixture array and `state.suspendedCharacterIds` from Task 1.
- Produces: `api.write.issuePlayerFlag`, `api.write.kickPlayer`, `api.write.banPlayer`,
  `api.write.unbanPlayer`, `api.write.suspendCharacter`, `api.write.unsuspendCharacter` — Tasks 4
  and 5 call these directly.

- [ ] **Step 1: Add the six write calls**

In `src/api/writeApi.ts`, add (the existing `unlockPlayer2fa` stays exactly as-is, just above
these):

```ts
    issuePlayerFlag(
      segment: string,
      body: { color: 'yellow' | 'red'; reason: string; ban_duration_secs?: number },
      idempotencyKey?: string,
    ) {
      return http.request<AdminPlayerView>(
        `/api/v1/players/${encodeURIComponent(segment)}/flags`,
        { method: 'POST', body, idempotencyKey },
        AdminPlayerViewSchema,
      );
    },

    kickPlayer(segment: string, reason: string | undefined, idempotencyKey?: string) {
      return http.request<void>(`/api/v1/players/${encodeURIComponent(segment)}/kick`, {
        method: 'POST',
        body: reason !== undefined ? { reason } : {},
        idempotencyKey,
      });
    },

    banPlayer(
      segment: string,
      body: {
        reason: string;
        duration_secs?: number;
        overwrite?: boolean;
        target_username?: string;
        // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's "ban by
        // email" section. `xindeler-zuul` hasn't decided its own final shape for this yet.
        ban_email?: boolean;
      },
      idempotencyKey?: string,
    ) {
      return http.request<BanPlayerResponse>(
        `/api/v1/players/${encodeURIComponent(segment)}/ban`,
        { method: 'POST', body, idempotencyKey },
        BanPlayerResponseSchema,
      );
    },

    unbanPlayer(
      segment: string,
      body: { reason: string; target_username?: string },
      idempotencyKey?: string,
    ) {
      return http.request<UnbanPlayerResponse>(
        `/api/v1/players/${encodeURIComponent(segment)}/unban`,
        { method: 'POST', body, idempotencyKey },
        UnbanPlayerResponseSchema,
      );
    },

    // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's "ban by
    // character" section. Route path and body are a reasonable guess, not a contract.
    suspendCharacter(
      segment: string,
      characterId: number,
      reason: string,
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request(
        `/api/v1/players/${encodeURIComponent(segment)}/characters/${characterId}/suspend`,
        { method: 'POST', body: { reason }, idempotencyKey },
      );
    },

    unsuspendCharacter(segment: string, characterId: number, idempotencyKey?: string): Promise<void> {
      return http.request(
        `/api/v1/players/${encodeURIComponent(segment)}/characters/${characterId}/unsuspend`,
        { method: 'POST', body: {}, idempotencyKey },
      );
    },
```

Add the three new schema imports (`AdminPlayerView`, `AdminPlayerViewSchema`) to the existing
`import { ... } from './schemas'` block, and add these two new response schemas to
`src/api/schemas.ts` (near `PlayerDetailResponseSchema`, Task 1's own additions):

```ts
export const BanPlayerResponseSchema = z.object({
  account: AdminPlayerViewSchema.nullable(),
  connection: z.record(z.string(), z.unknown()).nullable(),
  outcome: z.enum(['success', 'banned_account_only', 'banned_connection_only', 'failed']),
});
export type BanPlayerResponse = z.infer<typeof BanPlayerResponseSchema>;

export const UnbanPlayerResponseSchema = z.object({
  account: AdminPlayerViewSchema.nullable(),
  connection_unbanned: z.boolean(),
  outcome: z.enum(['success', 'unbanned_account_only', 'unbanned_connection_only', 'failed']),
});
export type UnbanPlayerResponse = z.infer<typeof UnbanPlayerResponseSchema>;
```

`connection` (the `BanInfo`/engine-side payload) is validated only as "some object or null" —
matching `ChronicleResponseSchema`'s own existing precedent in this file for a shape this app
doesn't have a confirmed contract for yet and only ever displays generically, never destructures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Mock route — flag**

Create `tools/mock-gateway/src/routes/playerFlag.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const { color, reason } = req.body || {};
  if (color !== 'yellow' && color !== 'red') {
    return sendError(res, 400, 'invalid_body', 'color must be yellow or red');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  const flag = {
    id: player.flags.length + 1,
    color,
    reason: reason.trim(),
    issued_by_operator_uuid: req.operatorUuid,
    issued_at: Math.floor(Date.now() / 1000),
    decay_at: null,
    ban_until: null,
    revoked_at: null,
    revoked_by_operator_uuid: null,
  };
  player.flags.push(flag);
  if (color === 'red') player.account_state = 'blocked';

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.flag',
    payload: { target_segment: segment, color, reason: flag.reason },
    outcome: 'success',
  });

  res.json({
    username: player.alias.toLowerCase(),
    display_username: player.alias,
    email: player.email,
    email_verified: player.email_verified,
    account_state: player.account_state,
    flags: player.flags,
  });
});

module.exports = router;
```

- [ ] **Step 4: Mock route — kick**

Create `tools/mock-gateway/src/routes/playerKick.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.kick',
    payload: { target_segment: segment, reason: req.body?.reason ?? null },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 5: Mock route — ban (including the speculative `ban_email`)**

Create `tools/mock-gateway/src/routes/playerBan.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const { reason, ban_email: banEmail } = req.body || {};
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  player.account_state = 'banned';
  player.flags.push({
    id: player.flags.length + 1,
    color: 'red',
    reason: reason.trim(),
    issued_by_operator_uuid: req.operatorUuid,
    issued_at: Math.floor(Date.now() / 1000),
    decay_at: null,
    ban_until: null,
    revoked_at: null,
    revoked_by_operator_uuid: null,
  });

  // EXPECTED SHAPE, NOT CONFIRMED — see the design doc. The mock just remembers the flag on the
  // fixture row; there is no real "banned_emails" mechanism to call.
  if (banEmail === true) {
    player.emailBanned = true;
  }

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.ban',
    payload: { target_segment: segment, reason: reason.trim(), ban_email: banEmail === true },
    outcome: 'success',
  });

  res.json({
    account: {
      username: player.alias.toLowerCase(),
      display_username: player.alias,
      email: player.email,
      email_verified: player.email_verified,
      account_state: player.account_state,
      flags: player.flags,
    },
    connection: { banned_until: null },
    outcome: 'success',
  });
});

module.exports = router;
```

- [ ] **Step 6: Mock route — unban**

Create `tools/mock-gateway/src/routes/playerUnban.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const now = Math.floor(Date.now() / 1000);
  player.flags = player.flags.map((flag) =>
    flag.revoked_at === null
      ? { ...flag, revoked_at: now, revoked_by_operator_uuid: req.operatorUuid }
      : flag,
  );
  player.account_state = 'active';

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.unban',
    payload: { target_segment: segment, reason: req.body?.reason ?? null },
    outcome: 'success',
  });

  res.json({
    account: {
      username: player.alias.toLowerCase(),
      display_username: player.alias,
      email: player.email,
      email_verified: player.email_verified,
      account_state: player.account_state,
      flags: player.flags,
    },
    connection_unbanned: true,
    outcome: 'success',
  });
});

module.exports = router;
```

- [ ] **Step 7: Mock route — character suspend/unsuspend**

Create `tools/mock-gateway/src/routes/playerCharacterSuspend.js`:

```js
const express = require('express');
const { players } = require('../fixtures');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

function findCharacter(segment, characterId) {
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return null;
  const character = player.characters.find((c) => c.character_id === characterId);
  return character ? { player, character } : null;
}

// EXPECTED SHAPE, NOT CONFIRMED — see the design doc's ban-by-character section. Both routes
// below are a reasonable guess at what xindeler-new-horizon might expose, not a real contract.
router.post('/:characterId/suspend', (req, res) => {
  const characterId = Number(req.params.characterId);
  const found = findCharacter(req.params.segment, characterId);
  if (!found) return sendError(res, 404, 'not_found', 'character not found');

  const { reason } = req.body || {};
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  state.suspendedCharacterIds.add(characterId);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.suspend_character',
    payload: { target_segment: req.params.segment, character_id: characterId, reason: reason.trim() },
    outcome: 'success',
  });
  res.status(204).end();
});

router.post('/:characterId/unsuspend', (req, res) => {
  const characterId = Number(req.params.characterId);
  const found = findCharacter(req.params.segment, characterId);
  if (!found) return sendError(res, 404, 'not_found', 'character not found');

  state.suspendedCharacterIds.delete(characterId);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.unsuspend_character',
    payload: { target_segment: req.params.segment, character_id: characterId },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 8: Mount all five new routes, with CSRF + step-up**

In `tools/mock-gateway/server.js`, add the five requires alongside Task 1's two, and mount — kick
gets CSRF only (matching the real gateway's own bar), the rest get CSRF + step-up:

```js
const playerFlagRoutes = require('./src/routes/playerFlag');
const playerKickRoutes = require('./src/routes/playerKick');
const playerBanRoutes = require('./src/routes/playerBan');
const playerUnbanRoutes = require('./src/routes/playerUnban');
const playerCharacterSuspendRoutes = require('./src/routes/playerCharacterSuspend');
```

```js
app.use('/api/v1/players/:segment/flags', requireAuth, requireCsrf, requireStepUp, playerFlagRoutes);
app.use('/api/v1/players/:segment/kick', requireAuth, requireCsrf, playerKickRoutes);
app.use('/api/v1/players/:segment/ban', requireAuth, requireCsrf, requireStepUp, playerBanRoutes);
app.use('/api/v1/players/:segment/unban', requireAuth, requireCsrf, requireStepUp, playerUnbanRoutes);
app.use(
  '/api/v1/players/:segment/characters',
  requireAuth,
  requireCsrf,
  requireStepUp,
  playerCharacterSuspendRoutes,
);
```

Add these **before** Task 1's `app.use('/api/v1/players', requireAuth, playerDetailRoutes);` line
— same ordering reasoning as Task 1 Step 7 (more specific paths before the generic `:segment`
catch-all).

- [ ] **Step 9: Manual verification**

With `npm run mock-gateway` running and a valid session:

```bash
curl -s -X POST http://localhost:4000/api/v1/players/ref-doran-0004/ban \
  -H "Content-Type: application/json" -H "Cookie: <cookie>" -H "X-CSRF-Token: <csrf>" \
  -d '{"reason":"prueba","ban_email":true}' | jq
curl -s http://localhost:4000/api/v1/players/ref-doran-0004 -H "Cookie: <cookie>" | jq '.moderation.account_state'
```

Expected: the ban call returns `outcome: "success"`; the follow-up detail call shows
`account_state: "banned"`.

- [ ] **Step 10: Commit**

```bash
git add src/api/writeApi.ts src/api/schemas.ts tools/mock-gateway/src/routes/playerFlag.js \
  tools/mock-gateway/src/routes/playerKick.js tools/mock-gateway/src/routes/playerBan.js \
  tools/mock-gateway/src/routes/playerUnban.js \
  tools/mock-gateway/src/routes/playerCharacterSuspend.js tools/mock-gateway/server.js
git commit -m "feat(oc35): player moderation write endpoints (flag/kick/ban/unban/character-suspend)"
```

---

## Task 3: Master screen — player directory

**Files:**
- Create: `src/features/players/usePlayerDirectoryQuery.ts`
- Create: `src/features/players/PlayerDirectoryRow.tsx`
- Modify: `src/features/players/PlayersScreen.tsx`
- Move: `app/(tabs)/players.tsx` → `app/(tabs)/players/index.tsx`

**Interfaces:**
- Consumes: `api.read.getPlayerDirectory` (Task 1), `PlayerDirectoryRow`/
  `PlayerDirectoryResponse` types (Task 1).
- Produces: nothing new consumed by later tasks — Task 4 creates its own route file alongside this
  one's new location.

- [ ] **Step 1: Directory query hook**

Create `src/features/players/usePlayerDirectoryQuery.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';

import { queryKeys } from '@/api/queryClient';

// A separate hook from `usePlayersQuery` — deliberately. That one backs `OracleDryRunScreen`'s
// player-targeting list (`GET /players`, online aliases only) and stays untouched; this one backs
// the moderation directory (`GET /players/directory`, online + offline, richer per-row data).
export function usePlayerDirectoryQuery(stateFilter: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.players, 'directory', stateFilter ?? 'all'],
    queryFn: () => api.read.getPlayerDirectory(undefined, undefined, stateFilter),
  });
}
```

Confirmed against the real `src/api/queryClient.ts`: `queryKeys.players` is `['players'] as
const`. The spread above therefore produces `['players', 'directory', <filter>]` — a sibling key
space to `usePlayersQuery`'s own `['players']` key, not a collision (react-query keys are matched
by exact array equality/prefix, not string equality).

- [ ] **Step 2: Directory row component**

Create `src/features/players/PlayerDirectoryRow.tsx`:

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { PlayerDirectoryRow as PlayerDirectoryRowType } from '@/api/schemas';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

const STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  blocked: 'Bloqueado',
  banned: 'Baneado',
  deactivated: 'Desactivado',
};

// Any `account_state` not in `STATE_LABELS` (a future value this app doesn't know about yet)
// falls back to the raw string rather than hiding the badge — same "show the real value, don't
// pretend to a distinction we can't make" philosophy `ban`/`unban`'s outcome handling already
// uses elsewhere in this feature.
function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export const PlayerDirectoryRow = memo(function PlayerDirectoryRow({
  player,
}: {
  player: PlayerDirectoryRowType;
}) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/players/${encodeURIComponent(player.reference)}`)}
      accessibilityRole="button"
      className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark"
    >
      <View className="flex-row items-center gap-2">
        {player.online && (
          <View className="h-2 w-2 rounded-full bg-accent-cyan dark:bg-night-accent-cyan" />
        )}
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {player.display_username}
        </Text>
      </View>
      {player.account_state !== 'active' && (
        <Text
          className="text-xs text-danger dark:text-night-danger"
          style={{ fontFamily: fonts.regular }}
        >
          {stateLabel(player.account_state)}
        </Text>
      )}
    </Pressable>
  );
});
```

`useRouter().push` with a plain template-string path (not a typed `href` object) is deliberate —
this app's `typedRoutes: true` experiment only validates statically-known paths, and a dynamic
segment built from runtime data needs the untyped string form; every other dynamic navigation
concern in this codebase (there isn't one yet — this is the first) would hit the same thing.

- [ ] **Step 3: Rewrite `PlayersScreen.tsx`**

Replace its entire contents:

```tsx
import { useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Pressable } from '@/ui/Pressable';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerDirectoryRow } from './PlayerDirectoryRow';
import { usePlayerDirectoryQuery } from './usePlayerDirectoryQuery';

const STATE_FILTERS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'blocked', label: 'Bloqueados' },
  { value: 'banned', label: 'Baneados' },
  { value: 'deactivated', label: 'Desactivados' },
];

export function PlayersScreen() {
  const [stateFilter, setStateFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const query = usePlayerDirectoryQuery(stateFilter);
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugadores" error={query.error} />;
    }
    return <Empty title="Jugadores" message="Cargando…" />;
  }

  const searchLower = search.trim().toLowerCase();
  const players = query.data.players.filter((player) =>
    searchLower.length === 0 ? true : player.display_username.toLowerCase().includes(searchLower),
  );

  return (
    <View className="flex-1">
      <View className="gap-3 px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Jugadores (${players.length})`}
        </Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-lg border border-steel-dark bg-bg-surface px-4 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
          style={{ fontFamily: fonts.regular }}
        />
        <View className="flex-row flex-wrap gap-2">
          {STATE_FILTERS.map((filter) => (
            <Pressable
              key={filter.label}
              onPress={() => setStateFilter(filter.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: stateFilter === filter.value }}
              className={`rounded-full border px-3 py-1 ${
                stateFilter === filter.value
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  stateFilter === filter.value
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={players}
        keyExtractor={(player) => player.reference}
        renderItem={({ item }) => <PlayerDirectoryRow player={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin jugadores.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

Cursor-based "load more" pagination is deliberately not included in this first version — the
design doc's own `next_cursor` field is always `null` from the mock (Task 1's own note), so there
is nothing to manually verify a "load more" interaction against yet; add it in a follow-up once
either the mock grows enough fixtures to need it or the real backend is reachable.

Confirmed against real usage (`grep -rn "PlayerRow\b" src/ app/`): `PlayerRow.tsx` (the old,
`Player`-string-based row) is imported only by the old `PlayersScreen.tsx` body this step just
replaced — no other file references it. Delete it as part of this step:

```bash
git rm src/features/players/PlayerRow.tsx
```

- [ ] **Step 4: Move the route file**

```bash
mkdir -p "app/(tabs)/players"
git mv "app/(tabs)/players.tsx" "app/(tabs)/players/index.tsx"
```

Its contents don't need to change — `PlayersScreen` still imports the same way, and Expo Router
resolves `/players` to `players/index.tsx` the same as it did to `players.tsx`, so
`app/(tabs)/_layout.tsx`'s `DESTINATIONS` array (`href: '/players'`) needs no change.

- [ ] **Step 5: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors — this also regenerates Expo Router's typed-route declarations for the moved
file; if it errors specifically about `href: '/players'` no longer matching, re-run
`npx expo start` once to force typegen, then re-run `tsc`.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if needed).

- [ ] **Step 6: Manual verification**

Run `npm run mock-gateway` + `npx expo start --web`, log in (`matias`/`mock`/`000000`), go to
Jugadores. Confirm: 7 rows render (including offline `Thistle`, no online dot), `Grix` shows a
"Bloqueado" badge, the state filter chips narrow the list correctly (tap "Bloqueados" → only
`Grix`), the search field filters by name. Repeat on at least one native target (iOS or Android
simulator).

- [ ] **Step 7: Commit**

```bash
git add src/features/players/usePlayerDirectoryQuery.ts src/features/players/PlayerDirectoryRow.tsx \
  src/features/players/PlayersScreen.tsx "app/(tabs)/players"
git commit -m "feat(oc35): replace the online-only Jugadores screen with the full player directory"
```

---

## Task 4: Detail screen — account moderation actions

**Files:**
- Create: `src/features/players/usePlayerDetailQuery.ts`
- Create: `src/features/players/PlayerDetailScreen.tsx`
- Create: `app/(tabs)/players/[reference].tsx`

**Interfaces:**
- Consumes: `api.read.getPlayerDetail` (Task 1), `api.write.issuePlayerFlag`/`kickPlayer`/
  `banPlayer`/`unbanPlayer` (Task 2), `PlayerDetailResponse`/`AdminPlayerView`/`PlayerFlag` types
  (Task 1), `ConfirmByTypingSheet`/`useDestructiveAction` (existing).
- Produces: `PlayerDetailScreen` component — Task 5 extends this same file's character list
  section and Task 6 extends this same file's ban form; both are edits to this task's output, not
  new files.

- [ ] **Step 1: Detail query hook**

Create `src/features/players/usePlayerDetailQuery.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';

export function usePlayerDetailQuery(reference: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.players, 'detail', reference],
    queryFn: () => api.read.getPlayerDetail(reference),
  });
}
```

- [ ] **Step 2: Detail screen — account header and flag/kick/ban/unban**

Create `src/features/players/PlayerDetailScreen.tsx`:

```tsx
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { PlayerFlag } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { usePlayerDetailQuery } from './usePlayerDetailQuery';

const STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  blocked: 'Bloqueado',
  banned: 'Baneado',
  deactivated: 'Desactivado',
};

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

function flagLabel(flag: PlayerFlag): string {
  const colorLabel = flag.color === 'red' ? 'Rojo' : 'Amarillo';
  const revoked = flag.revoked_at !== null ? ' (revocado)' : '';
  return `${colorLabel} — ${flag.reason}${revoked}`;
}

type ConfirmAction = 'flag_yellow' | 'flag_red' | 'kick' | 'ban' | 'unban';

const CONFIRM_WORDS: Record<ConfirmAction, string> = {
  flag_yellow: 'FLAG',
  flag_red: 'FLAG',
  kick: 'KICK',
  ban: 'BAN',
  unban: 'UNBAN',
};

export function PlayerDetailScreen({ reference }: { reference: string }) {
  const api = useApi();
  const query = usePlayerDetailQuery(reference);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reason, setReason] = useState('');

  const flagAction = useDestructiveAction((idempotencyKey) =>
    api.write.issuePlayerFlag(
      reference,
      { color: confirmAction === 'flag_red' ? 'red' : 'yellow', reason },
      idempotencyKey,
    ),
  );
  const kickAction = useDestructiveAction((idempotencyKey) =>
    api.write.kickPlayer(reference, reason || undefined, idempotencyKey),
  );
  const banAction = useDestructiveAction((idempotencyKey) =>
    api.write.banPlayer(reference, { reason }, idempotencyKey),
  );
  const unbanAction = useDestructiveAction((idempotencyKey) =>
    api.write.unbanPlayer(reference, { reason }, idempotencyKey),
  );

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugador" error={query.error} />;
    }
    return <Empty title="Jugador" message="Cargando…" />;
  }

  const { moderation, characters } = query.data;

  if (moderation === null) {
    return <Empty title="Jugador" message="No se pudo cargar la información de esta cuenta." />;
  }

  function handleSheetConfirm() {
    setConfirmAction(null);
    if (confirmAction === 'flag_yellow' || confirmAction === 'flag_red') {
      flagAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    } else if (confirmAction === 'kick') {
      kickAction.run().then(() => setReason(''));
    } else if (confirmAction === 'ban') {
      banAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    } else if (confirmAction === 'unban') {
      unbanAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    }
  }

  function confirmDescription(): string {
    switch (confirmAction) {
      case 'flag_yellow':
        return `Se emitirá un flag amarillo a ${moderation.display_username}.`;
      case 'flag_red':
        return `Se emitirá un flag rojo a ${moderation.display_username}.`;
      case 'kick':
        return `Se desconectará a ${moderation.display_username} si está conectado.`;
      case 'ban':
        return `Se baneará la cuenta de ${moderation.display_username}.`;
      case 'unban':
        return `Se levantará el ban y se revocarán los flags activos de ${moderation.display_username}.`;
      default:
        return '';
    }
  }

  return (
    <ScrollView className="flex-1 px-6 pt-8" contentContainerClassName="gap-4 pb-12">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        {moderation.display_username}
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        {`Estado: ${stateLabel(moderation.account_state)}`}
      </Text>

      {moderation.flags.length > 0 && (
        <View className="gap-2">
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Flags
          </Text>
          {moderation.flags.map((flag) => (
            <Text key={flag.id} className="text-sm text-steel-light dark:text-night-steel-light">
              {flagLabel(flag)}
            </Text>
          ))}
        </View>
      )}

      <TextField label="Razón" value={reason} onChangeText={setReason} autoCapitalize="none" />

      <View className="gap-3">
        <Button
          label="Emitir flag amarillo"
          onPress={() => setConfirmAction('flag_yellow')}
          loading={flagAction.pending}
          disabled={reason.trim().length === 0}
        />
        <Button
          label="Emitir flag rojo"
          onPress={() => setConfirmAction('flag_red')}
          loading={flagAction.pending}
          disabled={reason.trim().length === 0}
        />
        {flagAction.error && <ActionError error={flagAction.error} />}

        <Button label="Kick" onPress={() => setConfirmAction('kick')} loading={kickAction.pending} />
        {kickAction.error && <ActionError error={kickAction.error} />}

        <Button
          label="Ban"
          onPress={() => setConfirmAction('ban')}
          loading={banAction.pending}
          disabled={reason.trim().length === 0}
        />
        {banAction.error && <ActionError error={banAction.error} />}

        <Button
          label="Unban"
          onPress={() => setConfirmAction('unban')}
          loading={unbanAction.pending}
          disabled={reason.trim().length === 0}
        />
        {unbanAction.error && <ActionError error={unbanAction.error} />}
      </View>

      <ConfirmByTypingSheet
        visible={confirmAction !== null}
        word={confirmAction ? CONFIRM_WORDS[confirmAction] : ''}
        description={confirmDescription()}
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </ScrollView>
  );
}
```

Task 5 adds a character-list `View` below this (before the closing `</ScrollView>`); Task 6 adds
the ban-by-email checkbox inside the `Ban` button's block. Both are documented as edits to this
exact file in their own task sections below — do not treat this step's code as final until both
have landed.

- [ ] **Step 3: Dynamic route**

Create `app/(tabs)/players/[reference].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';

import { PlayerDetailScreen } from '@/features/players/PlayerDetailScreen';
import { Screen } from '@/ui/Screen';

export default function PlayerDetailRoute() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <Screen>
      <PlayerDetailScreen reference={reference} />
    </Screen>
  );
}
```

Confirmed against the real `src/ui/Screen.tsx`: it takes only `{ children: ReactNode }`, no other
props — the code above matches its real signature exactly, same as every other route file in this
app that wraps its screen in `<Screen>...</Screen>`.

- [ ] **Step 4: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors. If `npx expo start` hasn't run since Task 3 moved `players.tsx`, run it once
first to regenerate route types, since this task's new dynamic segment also needs typegen.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 5: Manual verification**

Against the mock (`npm run mock-gateway` + `npx expo start --web`, logged in): tap `Grix` from the
directory, confirm the detail screen shows "Bloqueado", one flag row ("Amarillo — Lenguaje
inapropiado..."). Type a reason, tap "Ban", confirm the sheet requires typing `BAN`, confirm it
completes and the screen updates to "Baneado". Tap "Unban", confirm it returns to "Activo" and the
flag shows "(revocado)". Repeat kick on `Kaelith` (should succeed with a `204`, no visible state
change since the mock doesn't track live connections). Verify on at least one native target too.

- [ ] **Step 6: Commit**

```bash
git add src/features/players/usePlayerDetailQuery.ts src/features/players/PlayerDetailScreen.tsx \
  "app/(tabs)/players/[reference].tsx"
git commit -m "feat(oc35): player detail screen with flag/kick/ban/unban actions"
```

---

## Task 5: Character list + ban by character

**Files:**
- Modify: `src/features/players/PlayerDetailScreen.tsx` (Task 4's file)

**Interfaces:**
- Consumes: `api.write.suspendCharacter`/`unsuspendCharacter` (Task 2), `CharacterSummary` type
  (Task 1, extended locally with the mock-only `suspended` field — see below).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the local character type for the mock-only `suspended` field**

`CharacterSummarySchema` (Task 1) intentionally does NOT include `suspended` — it's not part of
the confirmed real contract. Add a local, mock-only extension inline in
`PlayerDetailScreen.tsx` rather than modifying the shared schema:

```ts
// EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's ban-by-character
// section. `CharacterSummarySchema` itself stays exactly as the confirmed contract defines it;
// this is a local, mock-only extension so this screen can render suspension state without
// widening the shared schema to include a field only the mock currently sends.
type CharacterWithSuspension = CharacterSummary & { suspended?: boolean };
```

Add `CharacterSummary` to this file's existing `import type { PlayerFlag } from '@/api/schemas'`
line (making it `import type { CharacterSummary, PlayerFlag } from '@/api/schemas'`).

- [ ] **Step 2: Character-suspend confirm state**

Extend the `ConfirmAction` union and `CONFIRM_WORDS` map from Task 4:

```ts
type ConfirmAction =
  | 'flag_yellow'
  | 'flag_red'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'suspend_character'
  | 'unsuspend_character';

const CONFIRM_WORDS: Record<ConfirmAction, string> = {
  flag_yellow: 'FLAG',
  flag_red: 'FLAG',
  kick: 'KICK',
  ban: 'BAN',
  unban: 'UNBAN',
  suspend_character: 'SUSPEND',
  unsuspend_character: 'UNSUSPEND',
};
```

Add one more piece of state to track *which* character a suspend/unsuspend action targets — this
is the one action here that's per-character, not per-account, so `confirmAction` alone isn't
enough to know the target:

```ts
const [targetCharacter, setTargetCharacter] = useState<CharacterWithSuspension | null>(null);
```

- [ ] **Step 3: The suspend/unsuspend action and its `handleSheetConfirm`/`confirmDescription` branches**

Add alongside the four existing `useDestructiveAction` calls from Task 4:

```ts
  const suspendCharacterAction = useDestructiveAction((idempotencyKey) =>
    targetCharacter
      ? api.write.suspendCharacter(reference, targetCharacter.character_id, reason, idempotencyKey)
      : Promise.reject(new Error('no target character')),
  );
  const unsuspendCharacterAction = useDestructiveAction((idempotencyKey) =>
    targetCharacter
      ? api.write.unsuspendCharacter(reference, targetCharacter.character_id, idempotencyKey)
      : Promise.reject(new Error('no target character')),
  );
```

Extend `handleSheetConfirm` (Task 4's function) with two more branches, added before its closing
brace:

```ts
    } else if (confirmAction === 'suspend_character') {
      suspendCharacterAction.run().then(() => {
        setReason('');
        setTargetCharacter(null);
        query.refetch();
      });
    } else if (confirmAction === 'unsuspend_character') {
      unsuspendCharacterAction.run().then(() => {
        setTargetCharacter(null);
        query.refetch();
      });
    }
```

Extend `confirmDescription` (Task 4's function) with two more `case`s, added before `default`:

```ts
      case 'suspend_character':
        return `Se suspenderá al personaje ${targetCharacter?.name ?? ''}.`;
      case 'unsuspend_character':
        return `Se levantará la suspensión del personaje ${targetCharacter?.name ?? ''}.`;
```

- [ ] **Step 4: The character list itself**

Add this block right before the closing `</ScrollView>`, after the existing action buttons `View`:

```tsx
      {characters !== null && characters.length > 0 && (
        <View className="gap-2">
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Personajes
          </Text>
          {(characters as CharacterWithSuspension[]).map((character) => (
            <View
              key={character.character_id}
              className="flex-row items-center justify-between border-b border-steel-dark py-2 dark:border-night-steel-dark"
            >
              <View>
                <Text className="text-steel-light dark:text-night-steel-light">
                  {`${character.name} — Nv. ${character.level} ${character.class}`}
                </Text>
                {character.suspended === true && (
                  <Text className="text-xs text-danger dark:text-night-danger">Suspendido</Text>
                )}
              </View>
              <Button
                label={character.suspended === true ? 'Levantar suspensión' : 'Suspender'}
                onPress={() => {
                  setTargetCharacter(character);
                  setConfirmAction(
                    character.suspended === true ? 'unsuspend_character' : 'suspend_character',
                  );
                }}
                loading={
                  (character.suspended === true
                    ? unsuspendCharacterAction.pending
                    : suspendCharacterAction.pending) && targetCharacter?.character_id === character.character_id
                }
                disabled={character.suspended !== true && reason.trim().length === 0}
              />
            </View>
          ))}
        </View>
      )}
      {suspendCharacterAction.error && <ActionError error={suspendCharacterAction.error} />}
      {unsuspendCharacterAction.error && <ActionError error={unsuspendCharacterAction.error} />}
```

`Button` here has no `disabled`/`loading` conflict with the account-level actions above it — each
`useDestructiveAction` instance carries its own independent `pending`/`error` state, same as
`StatusScreen.tsx`'s four separate actions already do.

- [ ] **Step 5: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 6: Manual verification**

Against the mock: open `Voss` (has two characters). Tap "Suspender" on `Vossling` without typing a
reason first — confirm the button is disabled. Type a reason, tap "Suspender", confirm the sheet
requires `SUSPEND`, confirm the row updates to show "Suspendido" and the button now reads
"Levantar suspensión". Tap that, confirm `UNSUSPEND`, confirm the badge disappears. Verify on at
least one native target too.

- [ ] **Step 7: Commit**

```bash
git add src/features/players/PlayerDetailScreen.tsx
git commit -m "feat(oc35): per-character suspend/unsuspend action"
```

---

## Task 6: Ban by email

**Files:**
- Modify: `src/features/players/PlayerDetailScreen.tsx` (Task 4/5's file)

**Interfaces:**
- Consumes: `api.write.banPlayer`'s `ban_email` field (Task 2).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Checkbox state and the email-reveal text**

Add one more piece of state, alongside `reason`:

```ts
const [banEmail, setBanEmail] = useState(false);
```

Reset it alongside `reason` in every place Task 4/5's `handleSheetConfirm` already resets `reason`
after a **ban** completes specifically (not the other actions — `banEmail` is meaningless for
flag/kick/unban/character-suspend):

```ts
    } else if (confirmAction === 'ban') {
      banAction.run().then(() => {
        setReason('');
        setBanEmail(false);
        query.refetch();
      });
```

- [ ] **Step 2: Wire `banEmail` into the ban call**

Change Task 4's `banAction` definition:

```ts
  const banAction = useDestructiveAction((idempotencyKey) =>
    api.write.banPlayer(reference, { reason, ban_email: banEmail }, idempotencyKey),
  );
```

- [ ] **Step 3: The checkbox itself, showing the real email when checked**

Add this block right after the "Ban" `Button` from Task 4, before its own `{banAction.error && ...}`
line — the checkbox belongs visually with the action it modifies, matching the design doc's own
"not a separate screen or flow" call:

```tsx
        <Pressable
          onPress={() => setBanEmail((current) => !current)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: banEmail }}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 items-center justify-center rounded border ${
              banEmail
                ? 'border-accent-cyan bg-accent-cyan dark:border-night-accent-cyan dark:bg-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            {banEmail && (
              <Text className="text-xs text-bg-base dark:text-night-bg-base">✓</Text>
            )}
          </View>
          <Text className="text-sm text-steel-light dark:text-night-steel-light">
            También banear el email asociado
          </Text>
        </Pressable>
        {banEmail && moderation.email !== null && (
          <Text className="pl-7 text-xs text-steel-muted dark:text-night-steel-muted">
            {`también banear ${moderation.email}`}
          </Text>
        )}
```

Add `Pressable` to this file's existing `@/ui/Pressable` import (Task 4 doesn't import it yet,
since it has no bare checkbox — only `Button`, which already wraps `Pressable` internally).

- [ ] **Step 4: Reflect the checkbox in the confirm sheet's own description**

Change Task 4's `confirmDescription`'s `'ban'` case:

```ts
      case 'ban':
        return banEmail && moderation.email !== null
          ? `Se baneará la cuenta de ${moderation.display_username} y también su email (${moderation.email}).`
          : `Se baneará la cuenta de ${moderation.display_username}.`;
```

- [ ] **Step 5: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 6: Manual verification**

Against the mock: open `Doran`, type a reason, tap the new checkbox — confirm
"también banear doran@example.com" appears below it, and the confirm sheet's description
mentions the email. Confirm with `BAN`, confirm the ban still completes normally. Untick the
checkbox on a fresh ban attempt (a different fixture player) and confirm the description reverts
to the plain, no-email wording. Verify on at least one native target too.

- [ ] **Step 7: Commit**

```bash
git add src/features/players/PlayerDetailScreen.tsx
git commit -m "feat(oc35): ban-by-email checkbox on the account ban action"
```

---

## Final notes for whoever runs this plan

- Every task above verifies against `tools/mock-gateway` only — per the design doc, neither new
  capability (ban-by-email, ban-by-character) has a real backend, and the directory/detail reads
  (while a real, confirmed contract) aren't deployed to production yet either (`xindeler-zuul`'s
  `ZG-60`). Do not attempt to point any of this at a real gateway environment profile during
  verification.
- The two "EXPECTED SHAPE, NOT CONFIRMED" markers (on `ban_email` and the character-suspend
  routes) must survive final review — if a reviewer's own pass touches those lines, don't let the
  comment get edited out; it's load-bearing for whoever eventually reconciles this against a real
  backend contract.
