export type EnvironmentId = 'mock' | 'wireguard';

export type Environment = {
  id: EnvironmentId;
  label: string;
  baseUrl: string;
};

// Provisional: OC-13 hasn't built the real mock-gateway server yet. Adjust
// the port once it exists if it differs.
export const ENVIRONMENTS: Record<EnvironmentId, Environment> = {
  mock: {
    id: 'mock',
    label: 'Mock',
    baseUrl: 'http://localhost:4000',
  },
  wireguard: {
    id: 'wireguard',
    label: 'WireGuard',
    baseUrl: 'http://10.77.0.1:19260',
  },
};

export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = 'mock';
