import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { Screen } from '@/ui/Screen';

export default function MoreScreen() {
  return (
    <Screen>
      <EnvironmentSwitcher />
    </Screen>
  );
}
