import { Text, View } from 'react-native';

import { Pressable } from './Pressable';
import { fonts } from './theme';

export function ChipPicker<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
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
