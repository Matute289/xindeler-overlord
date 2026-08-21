import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuroraPlaceholderScreen } from '@/features/aurora/AuroraPlaceholderScreen';
import { OracleEventsScreen } from '@/features/oracle/OracleEventsScreen';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

type Section = 'oracle' | 'aurora';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'oracle', label: 'ORACLE' },
  { value: 'aurora', label: 'AURORA' },
];

export function AiSystemScreen() {
  const [section, setSection] = useState<Section>('oracle');

  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-6 pt-4">
        {SECTIONS.map(({ value, label }) => {
          const active = section === value;
          return (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`flex-1 items-center rounded-lg py-2 ${
                active
                  ? 'bg-accent-cyan dark:bg-night-accent-cyan'
                  : 'bg-bg-surface dark:bg-night-bg-surface'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-bg-base dark:text-night-bg-base'
                    : 'text-steel-light dark:text-night-steel-light'
                }
                style={{ fontFamily: fonts.semibold }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {section === 'oracle' ? <OracleEventsScreen /> : <AuroraPlaceholderScreen />}
    </View>
  );
}
