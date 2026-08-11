# Secure session storage (OC-15)

**Date:** 2026-08-11 · **Status:** approved (Matías delegated; design follows the gateway contract
directly, no open forks), implementing.

## Goal

One interface, two backends, from day one — not a retrofit — per `CLAUDE.md`'s repo layout note
and OC-15's own backlog description. This is storage/plumbing only: the actual login/TOTP screens
are OC-16, the typed API client that will consume this is OC-14. Neither exists yet; this ticket
just gives them a real interface to build against.

## Why one interface can't mean "the same operations" on both platforms

`docs/reference/gateway-api-contract.md` §2: native builds send `Authorization: Bearer <token>` on
every request; the token comes from `POST /api/v1/auth/totp`'s response and must live in
Keychain/Keystore (`expo-secure-store`). Web builds authenticate via an `HttpOnly` cookie the
gateway sets — by design, JavaScript **cannot read an `HttpOnly` cookie's value**; the browser
attaches it automatically to same-origin requests. So a "give me the stored token" interface is
meaningless on web: there is no token for JS to hold. `expo-secure-store` itself has no web
implementation at all (confirmed in Expo's own docs), which is exactly why OC-15's backlog note
says "never AsyncStorage" (wrong tool: not secure) but also implicitly rules out "use SecureStore
everywhere" (impossible: no web backend exists).

**The interface therefore models the actual need — "attach my credential to a request" — not the
storage mechanism:**

```ts
interface SessionStorage {
  save(session: StoredSession): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  getAuthHeader(): Promise<Record<string, string> | undefined>;
}
```

- **Native (`expo-secure-store`):** `save`/`read`/`clear` persist `{ token, operator, expiresAt }`
  in the Keychain/Keystore. `getAuthHeader()` returns `{ Authorization: 'Bearer <token>' }` from the
  stored token.
- **Web (in-memory + a non-secret `localStorage` marker):** the real credential is the browser's
  `HttpOnly` cookie, which this code never touches. `save()`/`read()`/`clear()` persist only
  `{ operator, expiresAt }` (**no token field — there is nothing to store**) to
  `localStorage`, purely so the UI can optimistically know "there was a session" without an extra
  round trip before the first real API call — this is a UX convenience, not a security boundary; the
  gateway is the only thing that actually enforces auth on web, via the cookie. `getAuthHeader()`
  always returns `undefined` — the browser attaches the cookie itself; requests must be made with
  `credentials: 'include'` (an OC-14 concern, noted here so it isn't lost).

Both backends implement the same four-method interface; callers (OC-14's API client, OC-16's login
screen) never branch on platform themselves.

## File structure

- `src/auth/types.ts` — `StoredSession` type, `SessionStorage` interface.
- `src/auth/SecureSessionStorage.native.ts` — `expo-secure-store` backend.
- `src/auth/SecureSessionStorage.web.ts` — `localStorage`-marker backend.
- `src/auth/sessionStorage.ts` — re-exports the platform-correct implementation. Metro/Expo's
  `.native.ts`/`.web.ts` extension resolution picks the right file automatically; no `Platform.select`
  needed here.

## Out of scope (do not build now)

- Login/TOTP screens and the actual `/api/v1/auth/*` calls (OC-16).
- The typed API client that will call `getAuthHeader()` (OC-14).
- Step-up TOTP caching for destructive actions (OC-23) — a related but separate mechanism (short-
  lived, not the long-lived session this ticket stores).

## Testing

No automated test runner in this repo. Verify via `npm run typecheck && npm run lint`. This is pure
storage plumbing with nothing to render yet — no UI to visually check; if there's an easy way to
exercise `save`/`read`/`clear` from a throwaway script or the RN debugger console on web, do that as
a sanity check, but it's not required to consider this done given nothing consumes it yet.
