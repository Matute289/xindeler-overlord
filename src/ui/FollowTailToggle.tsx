import { Text } from 'react-native';

import { Pressable } from './Pressable';
import { fonts } from './theme';

export function FollowTailToggle({
  followTail,
  onToggle,
}: {
  followTail: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: followTail }}
      className={`rounded-full border px-3 py-1 ${
        followTail
          ? 'border-accent-cyan dark:border-night-accent-cyan'
          : 'border-steel-dark dark:border-night-steel-dark'
      }`}
    >
      <Text
        className={
          followTail
            ? 'text-accent-cyan dark:text-night-accent-cyan'
            : 'text-steel-muted dark:text-night-steel-muted'
        }
        style={{ fontFamily: fonts.regular }}
      >
        {followTail ? 'Siguiendo' : 'Seguir'}
      </Text>
    </Pressable>
  );
}
