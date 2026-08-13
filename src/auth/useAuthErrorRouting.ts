import { useEffect } from 'react';

import { useAuth } from './AuthContext';

// Extracted from OC-18's useStatusQuery.ts, whose final review flagged this exact pattern as
// something that would get "more expensive to fix once four more screens copy it." OC-19 is the
// second screen that needs "route a query's error into AuthContext.handleAuthError" — the right
// moment to deduplicate.
export function useAuthErrorRouting(error: Error | null): void {
  const { handleAuthError } = useAuth();

  useEffect(() => {
    if (error) handleAuthError(error);
  }, [error, handleAuthError]);
}
