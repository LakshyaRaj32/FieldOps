import { Injectable } from '@nestjs/common';

import { AuthErrors } from '../common/errors/app-exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** Normalizes an email for storage and lookup: the unique index relies on this. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Owns the `users` table. Other modules go through this service, never through Prisma
 * directly (docs/backend-architecture.md, "Inside a module").
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  /**
   * Creates a user with the default role (WORKER). Self-registration can never choose a
   * role; elevated roles are granted by an administrator.
   *
   * Uniqueness is enforced by the database, not by a prior lookup, so two concurrent
   * registrations with the same email cannot both succeed.
   */
  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: { ...input, email: normalizeEmail(input.email) },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw AuthErrors.emailAlreadyRegistered();
      }
      throw error;
    }
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  /** Newest first. Tenancy scoping and cursor pagination arrive with organizations. */
  list(limit: number): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
