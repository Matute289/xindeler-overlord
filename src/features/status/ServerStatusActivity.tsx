import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

import type { ServerStatusActivityState } from './ServerStatusActivityState';

// This file MUST be `.tsx`, not `.ts`, despite containing no JSX — confirmed the hard way (a real
// iOS Simulator crash: `ArgumentCastException: The 2nd argument cannot be cast to type String`,
// because this stub's `layout` was the one actually reaching native `createLiveActivity` on iOS).
// Root cause, from `node_modules/metro-resolver/src/resolve.js`'s `resolveSourceFile`: Metro
// walks `resolver.sourceExts` (this project's order, from `expo/metro-config`: `ts` before `tsx`)
// one extension at a time, and for EACH extension checks `<name>.<platform>.<ext>` then the bare
// `<name>.<ext>` before moving to the next extension — it does not check all platform variants
// before falling back to generic. A generic `ServerStatusActivity.ts` therefore wins during the
// "ts" pass and shadows `ServerStatusActivity.ios.tsx`, which only gets checked in the later "tsx"
// pass that Metro never reaches. Keeping this file's extension identical to the real iOS
// implementation's (`.tsx`) puts both in the same resolution pass, where the platform-specific
// `.ios.tsx` correctly wins on iOS.
//
// Re-exported (not just imported) so `useServerStatusLiveActivity.ts`'s single
// `import { serverStatusActivity, type ServerStatusActivityState } from './ServerStatusActivity'`
// resolves on Android/Web too — Metro routes that extensionless specifier to this file there, so
// this file (like the iOS `ServerStatusActivity.ios.tsx` implementation) must itself re-export
// the type, not just consume it.
export type { ServerStatusActivityState };

// Android/Web stub. `@expo/ui/swift-ui` (used by the real iOS implementation in
// `ServerStatusActivity.ios.tsx`) throws unconditionally outside iOS — its `Text` component
// calls `requireNativeView` at module load time, before any `Platform.OS` check can help. This
// file intentionally has NO such import. `expo-widgets`' own `createLiveActivity` is already
// platform-safe (it has its own `ExpoWidgets.ios.js`/generic-fallback split, confirmed in
// `node_modules/expo-widgets/build/ExpoWidgets.js` — the fallback `LiveActivityFactoryStub`
// ignores the `layout` argument entirely), so `layout` below never actually runs outside iOS; it
// exists only to satisfy `createLiveActivity`'s type signature. See
// `docs/specs/2026-08-21-server-status-activity-platform-split-design.md`.
const layout: LiveActivityComponent<ServerStatusActivityState> = () => ({
  banner: null,
  compactLeading: null,
  compactTrailing: null,
  minimal: null,
});

export const serverStatusActivity = createLiveActivity<ServerStatusActivityState>(
  'ServerStatusActivity',
  layout,
);
