import { Role, type AuthResult } from '@fieldops/types';

import type { SecureValueStore } from '../storage/secureStorage';
import { createCredentialStore } from './credentialStore';

const session: AuthResult = {
  user: {
    id: 'user-1',
    email: 'asha@example.com',
    firstName: 'Asha',
    lastName: 'Verma',
    role: Role.WORKER,
    isActive: true,
    organization: null,
    organizationWideAccess: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  tokens: {
    tokenType: 'Bearer',
    accessToken: 'access-1',
    accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
    refreshToken: 'refresh-1',
    refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
  },
};

function memoryStorage(initial: string | null = null) {
  let value = initial;
  const storage: SecureValueStore & { readonly value: string | null } = {
    get value() {
      return value;
    },
    get: jest.fn(async () => value),
    set: jest.fn(async (next: string) => {
      value = next;
    }),
    clear: jest.fn(async () => {
      value = null;
    }),
  };
  return storage;
}

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warnSpy.mockRestore());

describe('credential store', () => {
  it('persists a session and restores it after an app restart', async () => {
    const storage = memoryStorage();
    await createCredentialStore(storage).save(session);

    const restarted = createCredentialStore(storage);
    expect(restarted.getAccessToken()).toBeUndefined();
    await expect(restarted.load()).resolves.toEqual(session);
    expect(restarted.getAccessToken()).toBe('access-1');
    expect(restarted.getRefreshToken()).toBe('refresh-1');
  });

  it('replaces rotated tokens and keeps the user', async () => {
    const storage = memoryStorage();
    const store = createCredentialStore(storage);
    await store.save(session);

    await store.updateTokens({
      ...session.tokens,
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });

    expect(store.getRefreshToken()).toBe('refresh-2');
    const persisted = JSON.parse(storage.value ?? '{}');
    expect(persisted.tokens.refreshToken).toBe('refresh-2');
    expect(persisted.user.id).toBe('user-1');
  });

  it('ignores token updates when nobody is signed in', async () => {
    const storage = memoryStorage();
    await createCredentialStore(storage).updateTokens(session.tokens);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('clears memory and secure storage', async () => {
    const storage = memoryStorage();
    const store = createCredentialStore(storage);
    await store.save(session);

    await store.clear();

    expect(store.getAccessToken()).toBeUndefined();
    expect(storage.value).toBeNull();
  });

  it('discards unreadable stored data instead of trusting it', async () => {
    const storage = memoryStorage('{"tokens":{"accessToken":1}}');
    const store = createCredentialStore(storage);

    await expect(store.load()).resolves.toBeUndefined();
    expect(storage.value).toBeNull();
  });

  it('keeps the in-memory session when secure storage fails, and logs no values', async () => {
    const storage = memoryStorage();
    (storage.set as jest.Mock).mockRejectedValueOnce(
      new Error('Keystore busy'),
    );
    const store = createCredentialStore(storage);

    await store.save(session);

    expect(store.getAccessToken()).toBe('access-1');
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain('Secure storage write failed');
    expect(logged).not.toContain('access-1');
    expect(logged).not.toContain('refresh-1');
  });
});
