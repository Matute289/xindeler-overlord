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
  setEnvironment: (id: EnvironmentId) => void;
};

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>(DEFAULT_ENVIRONMENT_ID);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'mock' || stored === 'wireguard') {
        setEnvironmentId(stored);
      }
    });
  }, []);

  const setEnvironment = (id: EnvironmentId) => {
    setEnvironmentId(id);
    AsyncStorage.setItem(STORAGE_KEY, id);
  };

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
