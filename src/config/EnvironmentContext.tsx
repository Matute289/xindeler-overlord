import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

import {
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENTS,
  type Environment,
  type EnvironmentId,
} from './environments';

const STORAGE_KEY = 'overlord.environment';

type EnvironmentContextValue = {
  environment: Environment;
  setEnvironment: (id: EnvironmentId) => Promise<void>;
};

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>(DEFAULT_ENVIRONMENT_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'mock' || stored === 'wireguard') {
          setEnvironmentId(stored);
        }
      })
      .finally(() => setReady(true));
  }, []);

  const setEnvironment = async (id: EnvironmentId) => {
    const previous = environmentId;
    setEnvironmentId(id);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, id);
    } catch (error) {
      // Persistence failed - revert so the badge/switcher never claim an
      // environment that isn't actually saved. There's no Banner primitive
      // yet (ops-ui SKILL.md, not built) to surface this beyond the snap-
      // back; worth revisiting once one exists.
      setEnvironmentId(previous);
      console.error('Failed to persist environment selection', error);
    }
  };

  // Don't render on the default environment while the persisted choice is
  // still loading - matches the font-loading gate in app/_layout.tsx.
  if (!ready) {
    return null;
  }

  return (
    <EnvironmentContext.Provider
      value={{ environment: ENVIRONMENTS[environmentId], setEnvironment }}
    >
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const value = useContext(EnvironmentContext);
  if (!value) {
    throw new Error('useEnvironment must be used within an EnvironmentProvider');
  }
  return value;
}
