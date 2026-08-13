import { Pressable, Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;

type LevelFilterProps = {
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
};

export function LevelFilter({ selected, onChange }: LevelFilterProps) {
  function toggle(level: string) {
    if (selected === null) {
      onChange(new Set(LEVELS.filter((candidate) => candidate !== level)));
      return;
    }
    const next = new Set(selected);
    if (next.has(level)) {
      next.delete(level);
    } else {
      next.add(level);
    }
    onChange(next.size === LEVELS.length ? null : next);
  }

  return (
    <View className="flex-row flex-wrap gap-2 px-4 pb-2">
      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === null }}
        className={`rounded-full border px-3 py-1 ${
          selected === null
            ? 'border-accent-cyan dark:border-night-accent-cyan'
            : 'border-steel-dark dark:border-night-steel-dark'
        }`}
      >
        <Text
          className={
            selected === null
              ? 'text-accent-cyan dark:text-night-accent-cyan'
              : 'text-steel-muted dark:text-night-steel-muted'
          }
          style={{ fontFamily: fonts.regular }}
        >
          Todos
        </Text>
      </Pressable>
      {LEVELS.map((level) => {
        const active = selected === null || selected.has(level);
        return (
          <Pressable
            key={level}
            onPress={() => toggle(level)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-full border px-3 py-1 ${
              active
                ? 'border-accent-cyan dark:border-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            <Text
              className={
                active
                  ? 'text-accent-cyan dark:text-night-accent-cyan'
                  : 'text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.regular }}
            >
              {level.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
