import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import { OperatorsScreen } from '@/features/operators/OperatorsScreen';
import { Screen } from '@/ui/Screen';

export default function OperatorsRoute() {
  const { isSuperuser } = useAuth();

  // `_layout.tsx`'s `href: null` only hides this route's tab-bar icon — it leaves the route
  // itself mounted and reachable (by URL on web, or the app's deep-link scheme on native). Guard
  // it here too, matching the app's existing `if (!hasPendingLogin) return <Redirect .../>`
  // idiom (app/(auth)/totp.tsx), so a non-superuser can never mount `OperatorsScreen` — closing
  // the deep-link surface AND preventing any stale cached `['operators']` query data from ever
  // rendering for them.
  if (!isSuperuser) {
    return <Redirect href="/more" />;
  }

  return (
    <Screen>
      <OperatorsScreen />
    </Screen>
  );
}
