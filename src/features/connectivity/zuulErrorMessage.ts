import { isApiError } from '@/api';
import type { EnvironmentId } from '@/config/environments';

const VPN_SUSPECT_CODES = new Set(['network_error', 'timeout']);

// The parenthetical is a deliberate, quiet Ghostbusters reference (Matías's request) — meant to
// read fine to anyone who's never seen the movie, and land as a wink for anyone who has.
export const VPN_DOWN_MESSAGE = 'No llego a Zuul — ¿está la VPN prendida? (¿A quién vas a llamar?)';

export function isLikelyVpnDown(environmentId: EnvironmentId, error: Error): boolean {
  return (
    environmentId === 'wireguard' &&
    isApiError(error) &&
    error.status === 0 &&
    VPN_SUSPECT_CODES.has(error.code)
  );
}

export function zuulErrorMessage(environmentId: EnvironmentId, error: Error): string {
  return isLikelyVpnDown(environmentId, error) ? VPN_DOWN_MESSAGE : error.message;
}
