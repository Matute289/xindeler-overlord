import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';
import { ENVIRONMENTS } from '@/config/environments';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

export function EnvironmentSwitcher() {
  const { environment, setEnvironment } = useEnvironment();

  return (
    <View className="flex-1 px-6 pt-8">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Entorno
      </Text>
      <Text
        className="mt-1 text-base text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        A qué servidor le habla la app. Elegí con cuidado — nunca asumas que estás en el mock.
      </Text>
      <View className="mt-6 gap-3">
        {Object.values(ENVIRONMENTS).map((env) => {
          const active = env.id === environment.id;
          return (
            <Pressable
              key={env.id}
              onPress={() => setEnvironment(env.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${env.label}, ${env.baseUrl}`}
              className={`rounded-lg border px-4 py-3 ${
                active
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-light dark:text-night-steel-light'
                }
                style={{ fontFamily: active ? fonts.semibold : fonts.regular }}
              >
                {env.label}
              </Text>
              <Text
                className="text-steel-muted dark:text-night-steel-muted"
                style={{ fontFamily: fonts.regular }}
              >
                {env.baseUrl}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
