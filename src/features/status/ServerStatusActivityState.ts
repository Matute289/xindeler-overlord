// Kept in sync with `useServerStatusLiveActivity.ts`'s own copy of this shape (that file cannot
// import this type directly — see the comment there for why) and loosely mirrors
// `useLifecycleState.ts`'s `LifecycleState` union plus the two fields off `Status`
// (`players_online`, `pending_shutdown.seconds_left`) this activity actually needs. Deliberately
// NOT the full `Status` object — only what's rendered here, kept small since every field crosses
// into the widget extension's own process on every `.start()`/`.update()` call.
//
// Extracted to its own file (not defined inside `ServerStatusActivity.ios.tsx`) so both the real
// iOS implementation and the Android/Web stub can import the identical type without duplicating
// it — see `docs/specs/2026-08-21-server-status-activity-platform-split-design.md`.
export type ServerStatusActivityState = {
  lifecycleState: 'running' | 'draining' | 'stopped' | 'starting';
  playersOnline: number;
  drainSecondsLeft: number | null;
};
