import { Link } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEnvironment } from '@/config/EnvironmentContext';
import { Pressable } from '@/ui/Pressable';

// Persistent, always-visible reminder of which server this app talks to.
// Rendered once above the nav shell (see app/(tabs)/_layout.tsx and
// app/(auth)/_layout.tsx) so every tab/screen gets it automatically — never
// re-implement this per screen. `linkHref` lets each nav shell point at its
// own switcher route (the authenticated shell's `/more` vs. the unauthenticated
// `(auth)` group's `/environment`, since `/more` lives inside the
// authenticated-only `(tabs)` group and is unreachable while logged out).
export function EnvironmentBadge({
  linkHref = '/more',
  // For the one screen (login) that renders full-bleed background art behind this badge
  // instead of the app's usual flat surface — swaps the opaque bar for a floating pill so the
  // art shows through underneath, while still absorbing the same top safe-area inset either way
  // (that's `SafeAreaView`'s job here, unrelated to which variant is showing).
  overlay = false,
}: {
  linkHref?: '/more' | '/environment';
  overlay?: boolean;
} = {}) {
  const { environment } = useEnvironment();

  return (
    <SafeAreaView
      edges={['top']}
      className={
        overlay ? 'absolute inset-x-0 top-0 z-10' : 'bg-bg-surface dark:bg-night-bg-surface'
      }
    >
      <Link href={linkHref} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Entorno activo: ${environment.label}. Tocá para cambiarlo.`}
          className={
            overlay
              ? 'mt-2 items-center self-center rounded-full bg-black/40 px-3 py-1'
              : 'items-center border-b border-steel-dark px-4 py-1 dark:border-night-steel-dark'
          }
        >
          <Text
            className={
              overlay
                ? 'text-xs uppercase text-night-accent-cyan'
                : 'text-xs uppercase text-accent-cyan dark:text-night-accent-cyan'
            }
          >
            {environment.label}
          </Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}
