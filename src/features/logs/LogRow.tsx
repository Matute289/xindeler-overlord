import * as Clipboard from 'expo-clipboard';
import { memo } from 'react';
import { Text } from 'react-native';

import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

// OC-67: the real gateway sends raw text lines, not `{ts, level, target, message}` — no
// timestamp/level/target to show as separate columns or color by (see `LogLineSchema`'s own
// comment). Renders the line as-is, monospace, same convention a plain log viewer uses.
export const LogRow = memo(function LogRow({ line }: { line: string }) {
  return (
    <Pressable
      onLongPress={() => {
        void Clipboard.setStringAsync(line);
      }}
      className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark"
    >
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      >
        {line}
      </Text>
    </Pressable>
  );
});
