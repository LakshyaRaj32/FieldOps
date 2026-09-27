import { Injectable } from '@nestjs/common';

/**
 * Who has a live realtime connection right now (the app is open and online). Kept in memory
 * by the gateway: a count of open sockets per user. Single-instance until the Socket.IO
 * Redis adapter (Phase 5); the dashboard's "online" figure is a hint, never used to decide
 * anything.
 */
@Injectable()
export class PresenceService {
  private readonly connections = new Map<string, number>();

  connected(userId: string): void {
    this.connections.set(userId, (this.connections.get(userId) ?? 0) + 1);
  }

  disconnected(userId: string): void {
    const count = (this.connections.get(userId) ?? 0) - 1;
    if (count > 0) {
      this.connections.set(userId, count);
    } else {
      this.connections.delete(userId);
    }
  }

  /** How many of `userIds` are connected. */
  countOnline(userIds: readonly string[]): number {
    return userIds.filter(id => this.connections.has(id)).length;
  }
}
