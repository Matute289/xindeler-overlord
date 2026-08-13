import { Text, View } from 'react-native';

import { useStreamStatus } from '@/stream/StreamContext';

// Global, always-mounted indicator that the one SSE connection this app
// keeps (see src/stream/) is down and retrying — never on the ordinary
// few-hundred-ms 'connecting' state every login passes through, only on
// 'reconnecting', which means the stream was open and then wasn't.
export function StreamStatusBanner() {
  const status = useStreamStatus();

  if (status !== 'reconnecting') return null;

  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">Reconectando con el gateway…</Text>
    </View>
  );
}
