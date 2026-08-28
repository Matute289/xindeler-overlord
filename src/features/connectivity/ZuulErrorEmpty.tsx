import { useEnvironment } from '@/config/EnvironmentContext';
import { Empty } from '@/ui/Empty';

import { zuulErrorMessage, isLikelyVpnDown } from './zuulErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function ZuulErrorEmpty({ title, error }: { title: string; error: Error }) {
  const { environment } = useEnvironment();
  return (
    <Empty title={title} message={zuulErrorMessage(environment.id, error)}>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </Empty>
  );
}
