// src/ui/Empty.tsx
import { Text, View } from 'react-native';

import { useTheme } from './theme';

export function Empty({ title, message }: { title: string; message: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: '700' }}>
        {title}
      </Text>
      <Text
        style={{
          marginTop: spacing.sm,
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: typography.body,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
