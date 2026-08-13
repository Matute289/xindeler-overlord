import type { TextInputProps } from 'react-native';
import { Text, TextInput, View } from 'react-native';

import { fonts, useTheme } from './theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, ...inputProps }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View className="w-full">
      <Text
        className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {label}
      </Text>
      <TextInput
        className="w-full rounded-lg border border-steel-dark bg-bg-surface px-4 py-3 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
        placeholderTextColor={colors.textMuted}
        style={{ fontFamily: fonts.regular }}
        accessibilityLabel={label}
        {...inputProps}
      />
    </View>
  );
}
