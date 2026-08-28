import { Text, View } from 'react-native';

import { Pressable } from './Pressable';
import { fonts } from './theme';

// `ChipPicker`'s multi-select sibling — same visual language, `selected: T[]` instead of
// `T | null`, `onToggle` adds/removes a value instead of replacing the whole selection. Exists
// for `OracleComposerScreen.tsx`'s `spawning_rules.entity_templates: string[]` (OC-72) — the only
// current caller, but generic enough to reuse if another multi-select need comes up.
export function MultiChipPicker<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            onPress={() => onToggle(option.value)}
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
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
