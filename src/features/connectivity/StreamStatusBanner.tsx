import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';
import { useStreamStatus } from '@/stream/StreamContext';

import { VPN_DOWN_MESSAGE } from './zuulErrorMessage';

// Global, always-mounted indicator that the one SSE connection this app
// keeps (see src/stream/) is down and retrying — never on the ordinary
// few-hundred-ms 'connecting' state every login passes through, only on
// 'reconnecting', which means the stream was open and then wasn't.
//
// On the `wireguard` profile, any reconnect is overwhelmingly likely to be the tunnel (there's no
// other network path to Zuul at all) — StreamClient itself doesn't expose an error code to
// check via the same isLikelyVpnDown() heuristic the REST-backed screens use (see
// zuulErrorMessage.ts), so this checks the environment directly instead. No VpnSettingsButton
// here — this is a thin, always-mounted top strip with no room for it; the actionable button lives
// wherever a screen has a full Empty-style block (ZuulErrorEmpty, login, TOTP).
export function StreamStatusBanner() {
  const status = useStreamStatus();
  const { environment } = useEnvironment();

  if (status !== 'reconnecting') return null;

  const vpnDown = environment.id === 'wireguard';

  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">
        {/* Ghostbusters reference (Matías's request) — the exact banner he first flagged as
            saying "Gateway" instead of "Zuul". "Cruzando los haces" reads as ordinary technical
            flavor to anyone who's never seen the movie, and lands as the reference for anyone
            who has. */}
        {vpnDown ? VPN_DOWN_MESSAGE : 'Reconectando con Zuul — cruzando los haces…'}
      </Text>
    </View>
  );
}
