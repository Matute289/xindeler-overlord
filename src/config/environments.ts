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

// OC-78: was unconditionally 'mock' — a leftover from before this app had a real production
// gateway to point at (`public` didn't exist yet). Now that it does, always defaulting a brand-
// new/cleared storage context to 'mock' is a real footgun in a production build: an operator
// opening this app for the first time ever on some device (e.g. a first-time-enrollment invite
// link opened in a fresh browser/email-client webview, which has its own separate storage from
// any browser the operator normally uses) would silently land on a local mock endpoint that
// doesn't exist from their machine, not on the real gateway they need — exactly the confusion
// this screen's own copy warns against ("Elegí con cuidado — nunca asumas que estás en el
// mock"). `__DEV__` (Metro/Expo's standard build-time global — true for a dev/dev-client build,
// false for a release/production export, including the one `deploy-web.yml` ships) keeps a fresh
// local dev checkout defaulting to the mock as before, without reintroducing that same footgun
// for a real production build.
export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = __DEV__ ? 'mock' : 'public';
