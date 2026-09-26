import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct horse battery staple';

  it('never stores the password: the hash is an Argon2id PHC string', async () => {
    const hash = await service.hash(password);

    expect(hash).not.toContain(password);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  });

  it('salts every hash, so equal passwords produce different hashes', async () => {
    const [first, second] = await Promise.all([
      service.hash(password),
      service.hash(password),
    ]);
    expect(first).not.toBe(second);
  });

  it('verifies the correct password and rejects others', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, password)).resolves.toBe(true);
    await expect(
      service.verify(hash, 'Correct horse battery staple'),
    ).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a failed verification', async () => {
    await expect(service.verify('not-a-hash', password)).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters for an upgrade', async () => {
    const hash = await service.hash(password);
    const weaker = hash.replace('m=19456,p=1,t=2', 'm=4096,p=1,t=1');

    expect(service.needsRehash(hash)).toBe(false);
    expect(service.needsRehash(weaker)).toBe(true);
  });

  it('verifyAgainstNothing always fails', async () => {
    await expect(service.verifyAgainstNothing(password)).resolves.toBe(false);
  });
});
