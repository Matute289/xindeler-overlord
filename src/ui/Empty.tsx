// src/ui/Empty.tsx
import { Text, View } from 'react-native';

import { fonts } from './theme';

export function Empty({ title, message }: { title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        {title}
      </Text>
      <Text
        className="mt-2 text-center text-base text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {message}
      </Text>
    </View>
  );
}
