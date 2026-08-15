import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@/api/ApiContext';

import { pushTokenService } from './pushTokenService';
import type { PushStatus } from './PushTokenService.types';

export function usePushRegistration() {
  const api = useApi();
  const [status, setStatus] = useState<PushStatus>({ state: 'not_requested' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    pushTokenService
      .getStatus()
      .then((s) => {
        if (!cancelled) {
          setStatus(s);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token, platform } = await pushTokenService.acquireToken();
      await api.write.registerPushToken(token, platform);
      await pushTokenService.persistToken(token);
      setStatus({ state: 'registered', token });
    } catch (err) {
      const refreshedStatus = await pushTokenService.getStatus();
      setStatus(refreshedStatus);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const disable = useCallback(async () => {
    if (status.state !== 'registered') return;
    setLoading(true);
    setError(null);
    try {
      await api.write.unregisterPushToken(status.token);
      await pushTokenService.clearStoredToken();
      setStatus({ state: 'not_requested' });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  return { status, loading, error, enable, disable };
}
