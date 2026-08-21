import { Text } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

// OC-47 Task 1 smoke test: proves the expo-widgets Live Activity pipeline renders real content
// end-to-end (JS layout -> babel-preset-expo's 'widget' directive transform -> native
// WidgetKit/ActivityKit rendering) before Task 2 builds the real countdown/status content on
// top of it. Deliberately static — no dynamic props, no real server data yet.
type ServerStatusActivityProps = {
  message: string;
};

// The `'widget'` directive (first statement in the function body, exactly like `'use client'`)
// is what babel-preset-expo's widgets-plugin looks for (see
// node_modules/babel-preset-expo/build/plugins/widgets-plugin.js) — it stringifies this exact
// function body at build time so it can be evaluated natively inside the widget extension. It
// must stay a block-bodied function (not an implicit-return arrow) for the directive to parse.
const layout: LiveActivityComponent<ServerStatusActivityProps> = (props) => {
  'widget';
  return {
    banner: <Text>{props.message}</Text>,
    compactLeading: <Text>OC</Text>,
    compactTrailing: <Text>47</Text>,
    minimal: <Text>47</Text>,
  };
};

// `createLiveActivity`'s real signature (confirmed from node_modules/expo-widgets/build/Widgets.d.ts):
//   createLiveActivity<T extends object>(name: string, liveActivity: LiveActivityComponent<T>): LiveActivityFactory<T>
// Unlike home-screen widgets, this `name` does NOT need to match any entry in app.config.ts's
// `expo-widgets` plugin `widgets` array — Live Activities are handled generically by the native
// module regardless of that config (confirmed by reading
// node_modules/expo-widgets/plugin/build/ios/withWidgetSourceFiles.js).
export const serverStatusActivity = createLiveActivity<ServerStatusActivityProps>(
  'ServerStatusActivity',
  layout,
);
