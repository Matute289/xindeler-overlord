import { useLocalSearchParams } from 'expo-router';

import { PlayerDetailScreen } from '@/features/players/PlayerDetailScreen';
import { Screen } from '@/ui/Screen';

export default function PlayerDetailRoute() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <Screen>
      <PlayerDetailScreen reference={reference} />
    </Screen>
  );
}
