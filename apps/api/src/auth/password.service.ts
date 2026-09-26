import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id parameters: the first OWASP Password Storage Cheat Sheet profile
 * (19 MiB memory, 2 iterations, parallelism 1). It resists GPU cracking while keeping memory
 * per concurrent login small enough for a low-cost staging instance. Parameters are
 * stored inside every hash, so they can be raised later: hashes made with older parameters
 * are upgraded on the user's next successful login (see needsRehash).
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Password hashing through the argon2 library. We never implement hashing ourselves and
 * never log passwords or hashes.
 */
@Injectable()
export class PasswordService {
  /** Hash of a random value, verified when an email is unknown (see verifyAgainstNothing). */
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, HASH_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed stored hash must not become a 500 or a successful login.
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  }

  /**
   * Spends the same time as a real verification when the email is not registered, so
   * response time does not reveal which emails have accounts. Always resolves to false.
   */
  async verifyAgainstNothing(password: string): Promise<false> {
    this.dummyHash ??= this.hash(randomUUID());
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
