# Native Bearer Session Auth (OC-58) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give native (iOS/Android) builds a genuinely working way to authenticate against the real `xindeler-zuul` gateway, now that its `ZG-52` ships a bearer-token alternative to the cookie.

**Architecture:** The login response's new `session_token` field is threaded through `AuthContext.completeLogin` into `sessionStorage.save(...)`, stored in `expo-secure-store` alongside the existing CSRF token, and returned by native's `getAuthHeader()` as `Authorization: Bearer <sessionToken>`. Web is untouched — it keeps using the cookie the gateway already checks first.

**Tech Stack:** Expo, `expo-secure-store`, Zod, Express (mock gateway).

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on anything that fails `npm run format:check`.
- `@/` resolves to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live pass. This ticket's core surface is native-only — full verification needs a real Simulator/device build (`npx expo run:ios`), not just `npx expo start --web`.
- `sessionToken` is a full bearer credential for the session (unlike `csrfToken`, which is deliberately non-secret) — never log it, never expose it outside native's own `SecureSessionStorage`.
- Web's behavior must remain provably unchanged: `getAuthHeader()` stays hardcoded `undefined` there, and `read()` must strip `sessionToken` from what it returns, exactly as it already strips `csrfToken`.

---

### Task 1: Thread `session_token` from login through native's bearer header

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/auth/types.ts`
- Modify: `src/auth/SecureSessionStorage.native.ts`
- Modify: `src/auth/SecureSessionStorage.web.ts`
- Modify: `src/auth/AuthContext.tsx`
- Modify: `tools/mock-gateway/src/routes/auth.js`
- Check, no change expected: `tools/mock-gateway/src/middleware/auth.js`

**Interfaces:**
- Consumes: nothing from an earlier task (first and only task).
- Produces: `SaveSessionInput` gains `sessionToken: string`. `SessionStorage.getAuthHeader()` on native now returns a real `{ Authorization: string }` when a session exists, instead of always `undefined`.

- [ ] **Step 1: Add `session_token` to `src/api/schemas.ts`'s `LoginResponseSchema`**

Current:

```ts
export const LoginResponseSchema = z.object({
  csrf_token: z.string(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  is_superuser: z.boolean(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

Replace with:

```ts
export const LoginResponseSchema = z.object({
  csrf_token: z.string(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  is_superuser: z.boolean(),
  // ZG-52 (xindeler-zuul) — the same raw session token minted for the Set-Cookie header, handed
  // back here too so native (no HTTP cookie jar) can store it and present it as
  // `Authorization: Bearer <session_token>` on every subsequent request. Web ignores this field
  // entirely — it already gets the equivalent HttpOnly cookie, which this value duplicates
  // rather than replaces. Confirmed against the real gateway's `login.rs` (LoginResponse struct)
  // — never log or telemetry this value, it's a full bearer credential for the session, not a
  // double-submit anti-CSRF token like `csrf_token`.
  session_token: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

- [ ] **Step 2: Rewrite `src/auth/types.ts`**

Replace the full file with:

```ts
export type StoredSession = {
  operatorUuid: string;
  operatorUsername: string;
  isSuperuser: boolean;
};

// No `expiresAt` — the real gateway's login response has none (OC-55; the session lives
// entirely in an HttpOnly cookie/bearer token, and there's no server-communicated expiry to
// store). `sessionToken` (OC-58, xindeler-zuul's ZG-52) is native's own bearer credential —
// present in the shared save payload since both platforms receive the same login response, but
// only native's `SecureSessionStorage` ever reads it back out; web's own `read()` strips it the
// same way it already strips `csrfToken` from what screens see.
export type SaveSessionInput = StoredSession & { csrfToken: string; sessionToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Native: `{ Authorization: 'Bearer <sessionToken>' }`, read from `expo-secure-store` (OC-58,
   * xindeler-zuul's ZG-52 — the real gateway now accepts this as an alternative to the cookie,
   * checked only when no session cookie is present). Web: always `undefined` — the browser
   * attaches the HttpOnly session cookie automatically, and the real gateway checks that first
   * regardless, so a web-side bearer header would be redundant. `undefined` if no session exists
   * on either platform.
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
  /**
   * `{ 'x-csrf-token': '<token>' }` on both platforms — unlike a bearer token, the CSRF token
   * is never a secret in the "only native can hold it" sense: it exists specifically to be
   * readable by this origin's own JS (that's the whole mechanism), so both platforms return a
   * real header here, not just native. `undefined` if no session exists.
   */
  getCsrfHeader(): Promise<Record<string, string> | undefined>;
}
```

- [ ] **Step 3: Rewrite `src/auth/SecureSessionStorage.native.ts`**

Replace the full file with:

```ts
import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithSecrets = StoredSession & { csrfToken?: string; sessionToken?: string };

export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // Single write, not separate token/metadata writes - two writes can be
    // interrupted between them, leaving read() and getCsrfHeader()
    // disagreeing about whether a session exists.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = await readStoredSession();
    if (!stored) return null;
    const { csrfToken: _csrfToken, sessionToken: _sessionToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  // OC-58 (xindeler-zuul's ZG-52) — the real gateway now accepts a bearer token as an
  // alternative to the session cookie for native, which has no HTTP cookie jar of its own.
  async getAuthHeader() {
    const stored = await readStoredSession();
    return stored?.sessionToken ? { Authorization: `Bearer ${stored.sessionToken}` } : undefined;
  },

  async getCsrfHeader() {
    const stored = await readStoredSession();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithSecrets | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithSecrets) : null;
}
```

- [ ] **Step 4: Rewrite `src/auth/SecureSessionStorage.web.ts`**

Replace the full file with:

```ts
import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithSecrets = StoredSession & { csrfToken?: string; sessionToken?: string };

// The real credential is the browser's HttpOnly session cookie, which this module never
// touches. `localStorage` only holds a non-secret marker so the UI can optimistically know
// "there was a session" without waiting on a network round trip; it is not what enforces auth.
// See docs/specs/2026-08-11-secure-session-storage-design.md.
//
// `csrfToken` is the one exception to "nothing secret lives here" — it isn't secret in that
// sense. A CSRF token exists specifically to be readable by this origin's own JS (that's the
// whole mechanism: proving the request came from a script that could read this origin's
// storage, which a cross-site attacker's forged request can't), so it's stored here alongside
// the metadata. `sessionToken` (OC-58) is genuinely secret — web never reads it back
// (`getAuthHeader()` always returns `undefined` here, the cookie already carries the session),
// but it's still part of the shared save payload since both platforms get the same login
// response; `read()` strips it the same way it already strips `csrfToken`.
export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = readStoredMetadata();
    if (!stored) return null;
    const { csrfToken: _csrfToken, sessionToken: _sessionToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = readStoredMetadata();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

function readStoredMetadata(): StoredMetadataWithSecrets | null {
  const raw = localStorage.getItem(METADATA_KEY);
  return raw ? (JSON.parse(raw) as StoredMetadataWithSecrets) : null;
}
```

- [ ] **Step 5: Add `sessionToken` to `AuthContext.completeLogin`'s save call**

In `src/auth/AuthContext.tsx`, find:

```tsx
      await sessionStorage.save({
        operatorUuid: result.operator_uuid,
        operatorUsername: result.operator_username,
        isSuperuser: result.is_superuser,
        csrfToken: result.csrf_token,
      });
```

Replace with:

```tsx
      await sessionStorage.save({
        operatorUuid: result.operator_uuid,
        operatorUsername: result.operator_username,
        isSuperuser: result.is_superuser,
        csrfToken: result.csrf_token,
        sessionToken: result.session_token,
      });
```

Nothing else in this file changes.

- [ ] **Step 6: Add `session_token` to the mock gateway's login response**

In `tools/mock-gateway/src/routes/auth.js`, find `issueSession`'s return statement:

```js
  return {
    csrf_token: csrfToken,
    operator_uuid: MOCK_OPERATOR_UUID,
    operator_username: username,
    is_superuser: true,
  };
```

Replace with:

```js
  return {
    csrf_token: csrfToken,
    operator_uuid: MOCK_OPERATOR_UUID,
    operator_username: username,
    is_superuser: true,
    // OC-58 — mirrors the real gateway's ZG-52: the same raw token minted for the Set-Cookie
    // header above, handed back here too so a native client can present it as a bearer header.
    session_token: token,
  };
```

`token` here is the same local variable this function already uses for `res.cookie('overlord_session', token, ...)` a few lines above — reuse it, don't generate a second value.

- [ ] **Step 7: Confirm the mock's `requireAuth` already accepts a bearer header**

Read `tools/mock-gateway/src/middleware/auth.js` fresh. It should already read `req.headers.authorization` and fall back to `req.cookies?.overlord_session` — this is how the mock's own (previously-fabricated) bearer mechanism already worked before this ticket. Confirm this is genuinely the case rather than assuming it; if it's NOT already there, report this as an unexpected finding rather than silently adding it — the task brief's own research did not re-verify this file's exact current content.

- [ ] **Step 8: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors. If `format:check` fails on any touched file, run `npx prettier --write <file>` and re-check.

- [ ] **Step 9: Live verification**

This ticket's core surface is native-only. Start `npm run mock-gateway`, then:

1. Run `npx expo run:ios` (a real Simulator build — this can take several minutes the first time). Confirm the build succeeds and the app installs/launches.
2. If Simulator UI interaction is possible in this environment: log in fresh, confirm the app reaches an authenticated screen with no `401`s, and confirm via whatever network-inspection is available that a subsequent authenticated request carries an `Authorization: Bearer <...>` header that the mock gateway accepts. Log out, confirm a subsequent request attempt carries no stale `Authorization` header. If an environment switch is reachable, confirm it clears the stored session (this should require no new code beyond what Task 1 already changed, since `sessionStorage.clear()` already wipes the whole stored record — confirm this holds rather than assuming it).
3. Separately, run `npx expo start --web` and confirm via network inspection (the `claude-in-chrome` browser tools) that no request, at any point, ever carries an `Authorization` header — web's behavior must be provably unchanged.
4. **If Simulator UI interaction is not possible in this environment** (this session's tooling may only control Chrome, not the Simulator's own UI — the same limitation `OC-46` hit repeatedly), report this honestly: confirm the native build itself succeeds and launches (a real, checkable signal), and do whatever CAN be verified (the web-side negative check in point 3 is always reachable). Do not claim the native bearer flow was observed working if it wasn't actually driven end-to-end — a build-succeeds-but-interaction-untested outcome is a legitimate `DONE_WITH_CONCERNS`, not something to paper over.

- [ ] **Step 10: Commit**

```bash
git add src/api/schemas.ts src/auth/types.ts src/auth/SecureSessionStorage.native.ts \
  src/auth/SecureSessionStorage.web.ts src/auth/AuthContext.tsx \
  tools/mock-gateway/src/routes/auth.js
git commit -m "feat(oc58): native session auth via bearer token (ZG-52)"
```
