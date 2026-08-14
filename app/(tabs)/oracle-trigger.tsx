import { OracleDryRunScreen } from '@/features/oracle/OracleDryRunScreen';
import { Screen } from '@/ui/Screen';

export default function OracleTriggerRoute() {
  return (
    <Screen>
      <OracleDryRunScreen />
    </Screen>
  );
}
