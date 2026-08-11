import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function StatusScreen() {
  return (
    <Screen>
      <Empty title="Status" message="Fase 1 — todavía sin conexión al gateway." />
    </Screen>
  );
}
