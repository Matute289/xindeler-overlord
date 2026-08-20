# Native session auth via bearer token (OC-58) design

## What's broken

Native (iOS/Android) builds of this app have never had a working way to authenticate against the
real, deployed `xindeler-zuul` gateway. Confirmed while investigating `OC-55`: the real gateway's
session mechanism was cookie-only, and this app's native storage layer assumed a bearer header the
gateway never actually read — `SecureSessionStorage.native.ts`'s `getAuthHeader()` has always
returned `undefined`, since there was never a real value to put there. Only the mock gateway ever
fabricated bearer support, so native has only ever "worked" against a fiction.

`xindeler-zuul`'s `ZG-52` (already shipped and deployed) fixed this gateway-side: `POST
/api/v1/login`'s response now includes a `session_token` field — the exact same raw session token
minted for the `Set-Cookie` header, handed back in the body too — and the session-auth extractor
(`AuthenticatedOperator`) now accepts either the `zuul_session` cookie (web, unchanged) or an
`Authorization: Bearer <session_token>` header (native, checked only if the cookie is absent).

## The fix

Purely mechanical — the gateway-side mechanism and field name are already fixed and confirmed
against the real source, so there's no design fork here, only correct plumbing.

`StoredSession`/`SaveSessionInput` gain a `sessionToken: string` field, alongside the existing
`csrfToken` — same treatment, same file, same atomic-write discipline `SecureSessionStorage`
already established for `csrfToken`. `AuthContext.completeLogin` saves `result.session_token`
(the new field `LoginResponseSchema` needs to add) into that new field, exactly where
`csrf_token`/`operator_uuid`/etc. are already saved.

`SecureSessionStorage.native.ts`'s `getAuthHeader()` stops unconditionally returning `undefined`
and instead reads `sessionToken` from the stored record, returning `{ Authorization: 'Bearer
<sessionToken>' }` when present — mirroring `getCsrfHeader()`'s own existing shape exactly.
`SecureSessionStorage.web.ts` is untouched: web keeps using the cookie, `getAuthHeader()` stays
`undefined` there always (the real gateway checks the cookie first regardless, so even sending a
web-side bearer header would be redundant, not just unnecessary).

The mock gateway (`tools/mock-gateway/src/routes/auth.js`) gains the same `session_token` field
(a fabricated but stable value, matching this mock's existing `csrf_token`/`operator_uuid`
conventions) in its login response, so this is genuinely testable locally.

`httpClient.ts` needs no change — it already calls `getAuthHeader()` per-request and merges
whatever it returns; the only change is that native's implementation now returns something real.

## Out of scope

- Any change to web's auth mechanism (cookie-based, unaffected, already correct).
- Any change to the gateway (`ZG-52` already shipped this).
- Re-deriving or refreshing the bearer token independently of a full login (there is no `/refresh`
  route on the real gateway — confirmed during `OC-53`/`OC-55` — a native session's bearer token
  is only ever obtained at login, same lifetime as the cookie it duplicates).

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass —
this is native-only surface (web is unaffected by design), so full verification needs a real
device/simulator pass (matching `OC-46`'s own precedent), not just `npx expo start --web`: (1) a
fresh login on native (`npx expo run:ios` or a comparable native target) actually reaches an
authenticated screen with no `401`s, confirming the bearer header is genuinely being accepted; (2)
logout clears the stored token (confirm no `Authorization` header is sent on the next request
attempt); (3) an environment switch (mock/wireguard/public) correctly clears the old environment's
token, matching `AuthContext.tsx`'s existing environment-switch effect (already covers all stored
session fields uniformly via `sessionStorage.clear()`, so this should require no new code, only
confirmation); (4) on web, confirm via network inspection that no `Authorization` header is ever
sent (the cookie continues to carry the session, exactly as before this ticket).
