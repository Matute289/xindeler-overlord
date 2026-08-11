import { Ionicons } from '@expo/vector-icons';
import { Link, Slot, Tabs, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';
import { useBreakpoint } from '@/ui/useBreakpoint';
import { fonts, useTheme } from '@/ui/theme';

type Destination = {
  href: '/' | '/players' | '/logs' | '/oracle' | '/more';
  routeName: 'index' | 'players' | 'logs' | 'oracle' | 'more';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const DESTINATIONS: Destination[] = [
  { href: '/', routeName: 'index', label: 'Status', icon: 'pulse-outline' },
  { href: '/players', routeName: 'players', label: 'Jugadores', icon: 'people-outline' },
  { href: '/logs', routeName: 'logs', label: 'Logs', icon: 'list-outline' },
  { href: '/oracle', routeName: 'oracle', label: 'ORACLE', icon: 'sparkles-outline' },
  { href: '/more', routeName: 'more', label: 'Más', icon: 'ellipsis-horizontal-outline' },
];

export default function TabsLayout() {
  const breakpoint = useBreakpoint();
  const { colors } = useTheme();

  return (
    <View className="flex-1">
      <EnvironmentBadge />
      <View className="flex-1">
        {breakpoint === 'wide' ? (
          <SidebarLayout />
        ) : (
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarLabelStyle: { fontFamily: fonts.regular },
              tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
              tabBarActiveTintColor: colors.accent,
              tabBarInactiveTintColor: colors.textMuted,
            }}
          >
            {DESTINATIONS.map((dest) => (
              <Tabs.Screen
                key={dest.routeName}
                name={dest.routeName}
                options={{
                  title: dest.label,
                  tabBarIcon: ({ color, size }) => (
                    <Ionicons name={dest.icon} color={color} size={size} />
                  ),
                }}
              />
            ))}
          </Tabs>
        )}
      </View>
    </View>
  );
}

function SidebarLayout() {
  const pathname = usePathname();
  const { colors } = useTheme();

  return (
    <View className="flex-1 flex-row bg-bg-base dark:bg-night-bg-base">
      {/* `left`/`bottom`: this is a persistent left-edge column, so only
          those device edges can be obscured (notch/Dynamic Island in
          landscape, home indicator). `top` is deliberately excluded —
          EnvironmentBadge (rendered above this whole layout) already
          accounts for the top inset, so adding it here would double-pad.
          `right` is an internal border, not a device edge — the content
          pane picks up its own safe area via Screen. */}
      <SafeAreaView
        edges={['left', 'bottom']}
        className="w-[220px] border-r border-steel-dark pt-8 dark:border-night-steel-dark"
      >
        {DESTINATIONS.map((dest) => {
          const active = pathname === dest.href;
          return (
            <Link key={dest.href} href={dest.href} asChild>
              <Pressable
                className={`flex-row items-center gap-2 px-6 py-4 ${
                  active ? 'bg-bg-surface dark:bg-night-bg-surface' : 'bg-transparent'
                }`}
              >
                <Ionicons name={dest.icon} color={active ? colors.accent : colors.text} size={20} />
                <Text
                  className={
                    active
                      ? 'text-accent-cyan dark:text-night-accent-cyan'
                      : 'text-steel-light dark:text-night-steel-light'
                  }
                  style={{ fontFamily: active ? fonts.semibold : fonts.regular }}
                >
                  {dest.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </SafeAreaView>
      <View className="flex-1">
        <Slot />
      </View>
    </View>
  );
}
