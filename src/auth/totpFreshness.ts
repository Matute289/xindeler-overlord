// OC-82 / ZG-78: xindeler-zuul's TOTP replay guard (server/src/totp.rs) rejects any code that
// matches or precedes the last step it already consumed — deliberate anti-replay, not a bug —
// but a code stays visible/valid for its whole 30s step, so an operator who submits it again
// right after it was just consumed (confirming enrollment, then immediately logging in with the
// same still-on-screen code) gets rejected with the gateway's one generic 401, indistinguishable
// from a wrong password. Confirmed root cause for a real incident, 2026-08-29 — see this repo's
// backlog.md OC-82 and xindeler-zuul's ZG-78.
//
// In-memory only (not sessionStorage) — same rationale as AuthContext's own `pendingCredentials`
// ref: this is a UX hint, not session state, and doesn't need to survive an app restart.
let lastConsumedAt: number | null = null;

export function markTotpConsumed(): void {
  lastConsumedAt = Date.now();
}

// Matches the gateway's own 30-second TOTP step.
const FRESHNESS_WINDOW_MS = 30_000;

export function wasTotpRecentlyConsumed(): boolean {
  return lastConsumedAt !== null && Date.now() - lastConsumedAt < FRESHNESS_WINDOW_MS;
}
