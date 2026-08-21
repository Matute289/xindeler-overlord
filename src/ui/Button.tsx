import { ActivityIndicator, Text } from 'react-native';

import { Pressable } from './Pressable';
import { fonts, useTheme } from './theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, loading = false, disabled = false }: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`w-full items-center justify-center rounded-lg bg-accent-cyan px-4 py-3 dark:bg-night-accent-cyan ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={colors.background} />
      ) : (
        <Text
          className="text-base text-bg-base dark:text-night-bg-base"
          style={{ fontFamily: fonts.semibold }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
