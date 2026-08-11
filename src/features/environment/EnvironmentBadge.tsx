import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEnvironment } from '@/config/EnvironmentContext';

// Persistent, always-visible reminder of which server this app talks to.
// Rendered once above the nav shell (see app/(tabs)/_layout.tsx) so every
// tab/screen gets it automatically — never re-implement this per screen.
export function EnvironmentBadge() {
  const { environment } = useEnvironment();

  return (
    <SafeAreaView edges={['top']} className="bg-bg-surface dark:bg-night-bg-surface">
      <Link href="/more" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Entorno activo: ${environment.label}. Tocá para cambiarlo.`}
          className="items-center border-b border-steel-dark px-4 py-1 dark:border-night-steel-dark"
        >
          <Text className="text-xs uppercase text-accent-cyan dark:text-night-accent-cyan">
            {environment.label}
          </Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
