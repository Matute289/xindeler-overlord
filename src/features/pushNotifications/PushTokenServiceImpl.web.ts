import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    return { state: 'unsupported' };
  },

  async acquireToken(): Promise<PushRegistration> {
    throw new Error('unsupported_platform');
  },

  async persistToken(): Promise<void> {},

  async clearStoredToken(): Promise<void> {},
};
