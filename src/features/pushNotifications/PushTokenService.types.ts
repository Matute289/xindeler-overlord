export type PushRegistration = { token: string; platform: 'ios' | 'android' };

export type PushStatus =
  | { state: 'unsupported' }
  | { state: 'not_requested' }
  | { state: 'denied' }
  | { state: 'registered'; token: string };

export type PushTokenService = {
  getStatus(): Promise<PushStatus>;
  acquireToken(): Promise<PushRegistration>;
  persistToken(token: string): Promise<void>;
  clearStoredToken(): Promise<void>;
};
