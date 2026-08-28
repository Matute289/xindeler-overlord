import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { useStepUpGate } from '@/auth/useStepUpGate';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const gate = useStepUpGate();

  if (gate.error) {
    return (
      <Empty title="Auditoría" message="No se pudo confirmar tu identidad.">
        <Button label="Reintentar" onPress={gate.retry} />
      </Empty>
    );
  }

  if (!gate.ready) {
    if (gate.pending) {
      return <Empty title="Auditoría" message="Confirmá tu identidad para continuar…" />;
    }
    // `gate.pending === false` here means the current attempt already settled with nothing to
    // show — the operator cancelled the TOTP prompt (a rejected/errored code takes the `gate.error`
    // branch above instead). Auditoría is a tab screen that stays mounted across tab re-focus, so
    // without a retry affordance here the operator would be stuck: no error, no button, and
    // navigating away and back doesn't remount anything either. This is reachable on first entry
    // too, but OC-59's own re-arm-on-lapsed-window feature makes it worse: an operator reading the
    // list who gets re-prompted and then cancels would otherwise lose the list permanently —
    // final-review Finding B, 2026-08-20.
    return (
      <Empty title="Auditoría" message="Confirmá tu identidad para continuar.">
        <Button label="Reintentar" onPress={gate.retry} />
      </Empty>
    );
  }

  // This is a tab screen (app/(tabs)/audit.tsx) that stays mounted after the first visit — it
  // does not remount on tab re-focus, so `gate.ready` would otherwise stay `true` forever once
  // set. The real gateway's step-up window is 5 minutes server-side; `onStepUpLapsed` is how
  // `AuditList` reports that a pull-to-refresh hit that lapsed window (a `403`) so the gate can
  // re-arm and put the TOTP prompt back in front of the operator — final-review Finding 2,
  // 2026-08-20. `gate.retry` is stable (useCallback in useStepUpGate) so this prop identity
  // doesn't churn across renders.
  return <AuditList onStepUpLapsed={gate.retry} />;
}

function AuditList({ onStepUpLapsed }: { onStepUpLapsed: () => void }) {
  const query = useAuditQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      // Inspect THIS refetch's own result rather than watching `query.error` generally —
      // the initial load's error path is already handled below (`query.data === undefined`
      // renders `ZuulErrorEmpty`), and a plain `useEffect` on `query.error` would also fire
      // on every future mount of this component with the SAME cached error object still sitting
      // in the query cache (TanStack Query cache persists across this component's unmount when
      // the gate re-arms and later closes again), re-triggering the gate before its own fresh
      // fetch has had a chance to resolve. Scoping this to the explicit pull-to-refresh call
      // avoids both. (The automatic-refetch path below hits the exact same trap and solves it a
      // different way — see its own comment.)
      const result = await query.refetch();
      if (isApiError(result.error) && result.error.status === 403) {
        onStepUpLapsed();
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  // Pull-to-refresh isn't the only way a lapsed step-up window shows up as a 403 here — and on
  // web it doesn't even work at all (react-native-web's RefreshControl is a no-op stub). TanStack
  // Query's default refetchOnWindowFocus (wired to AppState via QueryProvider.tsx on native, and
  // the browser's own focus/visibilitychange on web — see queryClient.ts's staleTime comment)
  // automatically refetches this query once it's stale (30s) and the operator returns to it,
  // which includes backgrounding the whole app for a few minutes and coming back — arguably the
  // MORE common way the 5-minute server-side window actually lapses. Without this effect, that
  // automatic refetch would get the same 403 `handleRefresh` above already knows how to handle,
  // but silently: `query.data` stays the last successful list, nothing re-arms the gate, and the
  // operator has no idea the list has gone stale.
  //
  // This intentionally is NOT `useFocusEffect` calling `handleRefresh()` on screen focus: React
  // Navigation focus only changes on in-app navigation (switching tabs), not on the whole app
  // backgrounding/foregrounding while Auditoría stays the active tab — exactly the scenario this
  // effect exists for. Disabling refetchOnWindowFocus in favor of that would silently drop
  // coverage for the app-backgrounding case rather than closing it.
  //
  // This also isn't the naive `useEffect` watching `query.error` that `handleRefresh`'s own
  // comment above warns against: on a fresh remount after the gate just re-armed and succeeded
  // again, `useQuery` can synchronously hand back the OLD 403 still sitting in the cache from the
  // PREVIOUS failed fetch, before the new fetch has resolved — naively re-arming on that would
  // loop forever. `gateReadySinceRef` anchors this AuditList instance's own mount time, which only
  // ever happens while `gate.ready` is true (AuditScreen renders this component nowhere else), so
  // any `errorUpdatedAt` from before that mount is leftover from a previous gate session and is
  // ignored; only a genuinely new error stamped AFTER this mount re-arms. `query.data !==
  // undefined` further scopes this to "already had a successful load, then a later refetch
  // failed" — the very first fetch failing takes the separate `ZuulErrorEmpty` branch below
  // instead. `handledErrorAtRef` is a last-mile guard against calling `onStepUpLapsed` twice for
  // the same error should this effect re-run before the resulting re-arm unmounts AuditList.
  // Captured lazily on this effect's first run (mount), not `useRef(Date.now())` — calling
  // `Date.now()` unconditionally in the render body is an impure render call (flagged by this
  // repo's react-compiler lint rule); doing it inside the effect, gated on "not captured yet", is
  // the pure-render-safe equivalent, and still lands at the same instant since this effect's
  // first invocation is mount.
  const gateReadySinceRef = useRef<number | undefined>(undefined);
  const handledErrorAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (gateReadySinceRef.current === undefined) {
      gateReadySinceRef.current = Date.now();
    }
    const errorUpdatedAt = query.errorUpdatedAt;
    if (
      query.data === undefined ||
      errorUpdatedAt === 0 ||
      errorUpdatedAt < gateReadySinceRef.current ||
      errorUpdatedAt === handledErrorAtRef.current
    ) {
      return;
    }
    if (isApiError(query.error) && query.error.status === 403) {
      handledErrorAtRef.current = errorUpdatedAt;
      onStepUpLapsed();
    }
  }, [query.data, query.error, query.errorUpdatedAt, onStepUpLapsed]);

  if (query.data === undefined) {
    if (query.error) {
      return <ZuulErrorEmpty title="Auditoría" error={query.error} />;
    }
    return <Empty title="Auditoría" message="Cargando…" />;
  }

  const rows = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Auditoría
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.id)}
        renderItem={({ item }) => <AuditLogRow row={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin actividad todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
