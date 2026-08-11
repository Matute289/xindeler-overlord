// Re-exports the platform-correct backend — Metro/Expo resolve
// `./SecureSessionStorage` to `.native.ts` (iOS/Android) or `.web.ts`
// automatically. Import from here, not the platform files directly.
export { sessionStorage } from './SecureSessionStorage';
export type { SaveSessionInput, SessionStorage, StoredSession } from './types';
