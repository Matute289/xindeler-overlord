import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { Screen } from '@/ui/Screen';

export default function AuthEnvironmentScreen() {
  return (
    <Screen>
      <EnvironmentSwitcher />
    </Screen>
  );
}
