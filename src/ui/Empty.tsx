// src/ui/Empty.tsx
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { fonts } from './theme';

export function Empty({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
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
      {children}
    </View>
  );
}
