import type { AuthResult, AuthTokens, UserProfile } from '@fieldops/types';

import { logger } from '../../utils/logger';
import {
  secureSessionStorage,
  type SecureValueStore,
} from '../storage/secureStorage';
import { isAuthTokens, isUserProfile } from './contracts';

/** What is persisted for a signed-in session. */
export interface StoredSession {
  readonly tokens: AuthTokens;
  /** Last known profile, so the app can open signed in while offline. */
  readonly user: UserProfile;
}

/**
 * The single owner of session credentials on the device.
 *
 * - The source of truth is secure storage (Android Keystore). An in-memory copy serves
 *   synchronous reads, such as adding the Authorization header to every request.
 * - Tokens are never put in Redux state or actions: Redux only learns WHO is signed in.
 * - Persistence failures are logged (without values) and do not break the current session;
 *   the user would only have to sign in again after restarting the app.
 */
export interface CredentialStore {
  /** Reads the persisted session at startup. Corrupt data is discarded. */
  load(): Promise<StoredSession | undefined>;
  save(session: AuthResult): Promise<void>;
  updateTokens(tokens: AuthTokens): Promise<void>;
  updateUser(user: UserProfile): Promise<void>;
  clear(): Promise<void>;
  getAccessToken(): string | undefined;
  getRefreshToken(): string | undefined;
}

function parseStoredSession(raw: string): StoredSession | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { tokens, user } = value as Record<string, unknown>;
    return isAuthTokens(tokens) && isUserProfile(user)
      ? { tokens, user }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createCredentialStore(
  storage: SecureValueStore,
): CredentialStore {
  let current: StoredSession | undefined;

  async function persist(): Promise<void> {
    try {
      if (current === undefined) {
        await storage.clear();
      } else {
        await storage.set(JSON.stringify(current));
      }
    } catch (error) {
      logger.warn('Secure storage write failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  return {
    async load() {
      let raw: string | null = null;
      try {
        raw = await storage.get();
      } catch (error) {
        logger.warn('Secure storage read failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      if (raw === null) {
        current = undefined;
        return undefined;
      }
      current = parseStoredSession(raw);
      if (current === undefined) {
        logger.warn('Discarding unreadable stored session');
        await persist();
      }
      return current;
    },
    async save({ tokens, user }) {
      current = { tokens, user };
      await persist();
    },
    async updateTokens(tokens) {
      if (current !== undefined) {
        current = { ...current, tokens };
        await persist();
      }
    },
    async updateUser(user) {
      if (current !== undefined) {
        current = { ...current, user };
        await persist();
      }
    },
    async clear() {
      current = undefined;
      await persist();
    },
    getAccessToken: () => current?.tokens.accessToken,
    getRefreshToken: () => current?.tokens.refreshToken,
  };
}

/** The app-wide store, backed by the Android Keystore. Tests create their own. */
export const credentialStore = createCredentialStore(secureSessionStorage);
