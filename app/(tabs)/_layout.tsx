import { Ionicons } from '@expo/vector-icons';
import { Link, Slot, Tabs, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useBreakpoint } from '@/ui/useBreakpoint';
import { useTheme } from '@/ui/theme';

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

  if (breakpoint === 'wide') {
    return <SidebarLayout />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
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
  );
}

function SidebarLayout() {
  const pathname = usePathname();
  const { colors, spacing } = useTheme();

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <View
        style={{
          width: 220,
          borderRightWidth: 1,
          borderRightColor: colors.border,
          paddingTop: spacing.xl,
        }}
      >
        {DESTINATIONS.map((dest) => {
          const active = pathname === dest.href;
          return (
            <Link key={dest.href} href={dest.href} asChild>
              <Pressable
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  backgroundColor: active ? colors.surface : 'transparent',
                }}
              >
                <Ionicons name={dest.icon} color={active ? colors.accent : colors.text} size={20} />
                <Text style={{ color: active ? colors.accent : colors.text }}>{dest.label}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
    </View>
  );
}
