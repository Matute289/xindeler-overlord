import { Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {label}
      </Text>
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {value}
      </Text>
    </View>
  );
}
