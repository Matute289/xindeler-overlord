export type EnvironmentId = 'mock' | 'wireguard' | 'public';

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
  // xindeler-zuul, in production (`zuul.xindeler.com`) -- also where this app's own Web build is
  // now served from (OC-38/ZG-58), same origin. Absolute URL here regardless -- keeps this entry
  // consistent with `mock`/`wireguard` above, and means this profile still works correctly even
  // if this same build is ever loaded from a different origin (e.g. a native build, or a locally
  // served copy of the Web export).
  public: {
    id: 'public',
    label: 'Público',
    baseUrl: 'https://zuul.xindeler.com',
  },
};

export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = 'mock';
