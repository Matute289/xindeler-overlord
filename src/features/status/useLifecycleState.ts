import type { Status } from '@/api/schemas';

export type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting';

// OC-63: there is no separate `lifecycle` SSE event on the real gateway -- confirmed against
// xindeler-zuul's real source, it never existed there, only in this repo's own speculative
// contract/mock (`docs/reference/gateway-api-contract.md`, `tools/mock-gateway`). `status` is
// pushed on every real change (gateway contract §3.1) and already carries everything this needs
// (`game_server`, `info.shutdown_pending_secs`, `info.shutdown_reason`), so it is now the single
// source of truth. This replaces the previous `live`/`deriveFromStatus`/`contradicts`
// reconciliation, which existed only to arbitrate between two independently-timed data paths --
// `status` and a real `lifecycle` push -- that no longer both exist.
export function useLifecycleState(
  status: Status | undefined,
): { state: LifecycleState; secondsLeft?: number } | undefined {
  if (!status) return undefined;

  if (status.info?.shutdown_pending_secs != null) {
    return { state: 'draining', secondsLeft: status.info.shutdown_pending_secs };
  }

  // `game_server` is `systemctl is-active`'s raw vocabulary, not a closed enum -- `'active'` and
  // `'activating'` are the only two values this app has a distinct UI state for; every other
  // value (`'inactive'`, `'failed'`, `'deactivating'`, `'reloading'`, `'unknown'`, or anything
  // systemd/xindeler-zuul might add later) folds into `'stopped'`. `'deactivating'` in particular
  // could arguably be its own `'draining'`-adjacent state, but without a `shutdown_pending_secs`
  // to count down (an immediate, non-graceful stop never sets one) there is nothing more to show
  // than `'stopped'` already communicates.
  if (status.game_server === 'active') return { state: 'running' };
  if (status.game_server === 'activating') return { state: 'starting' };
  return { state: 'stopped' };
}
