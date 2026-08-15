import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    return { state: 'unsupported' };
  },

  async register(): Promise<PushRegistration> {
    throw new Error('unsupported_platform');
  },

  async clearStoredToken(): Promise<void> {},
};
