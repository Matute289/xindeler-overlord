import type { ServerStatusActivityState } from './ServerStatusActivityState';
import { Text, VStack } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

// Re-exported (not just imported) so `useServerStatusLiveActivity.ts`'s single
// `import { serverStatusActivity, type ServerStatusActivityState } from './ServerStatusActivity'`
// resolves on iOS too — Metro routes that extensionless specifier to this file there, so this
// file (like the generic `ServerStatusActivity.ts` stub) must itself re-export the type, not just
// consume it.
export type { ServerStatusActivityState };

// The `'widget'` directive (first statement in the function body, exactly like `'use client'`) is
// what babel-preset-expo's widgets-plugin looks for (see
// node_modules/babel-preset-expo/build/plugins/widgets-plugin.js) — it stringifies this exact
// function body (via @babel/generator, verbatim AST -> source, no scope-checking) at build time
// so it can be evaluated natively inside the widget extension's own embedded JavaScriptCore
// runtime. Two consequences confirmed in Task 1's report, both load-bearing for how this function
// is written:
//   1. It must stay a block-bodied function (not an implicit-return arrow) for the directive to
//      parse — `!t.isBlockStatement(path.node.body)` bails the plugin out otherwise.
//   2. Nothing outside this function's own parameters is available at runtime — the surrounding
//      module scope is stripped. `Text`/`VStack` resolve as globals supplied by expo-widgets' own
//      pre-bundled `ExpoWidgets.bundle` (a real `@expo/ui/swift-ui`, not this file's import), but
//      any helper function or constant defined elsewhere in this file (e.g. a
//      `lifecycleLabel(state)` map reused from `StatusScreen.tsx`) would NOT be — so the Spanish
//      label mapping and countdown-window math are inlined directly in the function body below
//      rather than factored out, even though that duplicates `StatusScreen.tsx`'s own
//      `lifecycleLabel`.
const layout: LiveActivityComponent<ServerStatusActivityState> = (props) => {
  'widget';
  const stateLabel =
    props.lifecycleState === 'running'
      ? 'Activo'
      : props.lifecycleState === 'draining'
        ? 'Drenando'
        : props.lifecycleState === 'stopped'
          ? 'Detenido'
          : 'Iniciando';
  const playersLabel = `${props.playersOnline} jugadores`;
  // Real widget-native countdown primitive (@expo/ui/swift-ui's `Text` maps straight to
  // SwiftUI's `Text(timerInterval:countsDown:)`, confirmed present in
  // node_modules/@expo/ui/build/swift-ui/Text/index.d.ts) — once rendered, this ticks down on
  // its own via the system clock inside the widget extension process; it does NOT need a JS
  // timer or a `.update()` call every second. `lower` is "now" as of this render (i.e. as of
  // the most recent `.start()`/`.update()` call that produced this exact `drainSecondsLeft`),
  // `upper` is that instant plus the seconds remaining reported by the gateway.
  const countdown =
    props.drainSecondsLeft !== null ? (
      <Text
        timerInterval={{
          lower: new Date(),
          upper: new Date(Date.now() + props.drainSecondsLeft * 1000),
        }}
        countsDown
      />
    ) : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={4}>
        <Text>{stateLabel}</Text>
        <Text>{playersLabel}</Text>
        {countdown}
      </VStack>
    ),
    compactLeading: <Text>{stateLabel}</Text>,
    compactTrailing: countdown ?? <Text>{playersLabel}</Text>,
    minimal: <Text>{String(props.playersOnline)}</Text>,
  };
};

// `createLiveActivity`'s real signature (confirmed from node_modules/expo-widgets/build/Widgets.d.ts):
//   createLiveActivity<T extends object>(name: string, liveActivity: LiveActivityComponent<T>): LiveActivityFactory<T>
// Unlike home-screen widgets, this `name` does NOT need to match any entry in app.config.ts's
// `expo-widgets` plugin `widgets` array — Live Activities are handled generically by the native
// module regardless of that config (confirmed by reading
// node_modules/expo-widgets/plugin/build/ios/withWidgetSourceFiles.js).
export const serverStatusActivity = createLiveActivity<ServerStatusActivityState>(
  'ServerStatusActivity',
  layout,
);
