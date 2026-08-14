import { useEnvironment } from '@/config/EnvironmentContext';
import { Empty } from '@/ui/Empty';

import { gatewayErrorMessage, isLikelyVpnDown } from './gatewayErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function GatewayErrorEmpty({ title, error }: { title: string; error: Error }) {
  const { environment } = useEnvironment();
  return (
    <Empty title={title} message={gatewayErrorMessage(environment.id, error)}>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </Empty>
  );
}
