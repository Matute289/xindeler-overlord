import { isApiError } from '@/api';
import type { EnvironmentId } from '@/config/environments';

const VPN_SUSPECT_CODES = new Set(['network_error', 'timeout']);

export const VPN_DOWN_MESSAGE = 'No llego al gateway — ¿está la VPN prendida?';

export function isLikelyVpnDown(environmentId: EnvironmentId, error: Error): boolean {
  return (
    environmentId === 'wireguard' &&
    isApiError(error) &&
    error.status === 0 &&
    VPN_SUSPECT_CODES.has(error.code)
  );
}

export function gatewayErrorMessage(environmentId: EnvironmentId, error: Error): string {
  return isLikelyVpnDown(environmentId, error) ? VPN_DOWN_MESSAGE : error.message;
}
