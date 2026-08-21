import * as Clipboard from 'expo-clipboard';
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { LogLine } from '@/api/schemas';
import { Pressable } from '@/ui/Pressable';
import { formatTime } from '@/ui/formatTime';
import { fonts } from '@/ui/theme';

const LEVEL_COLOR_CLASSNAME: Record<string, string> = {
  error: 'text-danger dark:text-night-danger',
  warn: 'text-warning dark:text-night-warning',
  debug: 'text-steel-muted dark:text-night-steel-muted',
};
const DEFAULT_LEVEL_CLASSNAME = 'text-steel-light dark:text-night-steel-light';

export const LogRow = memo(function LogRow({ line }: { line: LogLine }) {
  const levelClassName = LEVEL_COLOR_CLASSNAME[line.level] ?? DEFAULT_LEVEL_CLASSNAME;

  return (
    <Pressable
      onLongPress={() => {
        void Clipboard.setStringAsync(`${line.ts} ${line.level} ${line.target}: ${line.message}`);
      }}
      className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark"
    >
      <View className="flex-row items-center gap-2">
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatTime(line.ts)}
        </Text>
        <Text className={levelClassName} style={{ fontFamily: fonts.semibold }}>
          {line.level.toUpperCase()}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {line.target}
        </Text>
      </View>
      <Text
        className="mt-1 text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      >
        {line.message}
      </Text>
    </Pressable>
  );
});
