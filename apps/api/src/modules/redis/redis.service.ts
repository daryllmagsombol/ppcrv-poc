import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { GeoStatusData, VoteShareData, UndervoteData } from './redis.types';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
      this.client.on('error', (err) =>
        this.logger.warn(`Redis connection error: ${err.message}`),
      );
      this.logger.log('Redis client created (will connect lazily)');
    } else {
      this.logger.warn('REDIS_URL not set — analytics will use DuckDB fallback');
    }
  }

  onModuleInit() {
    // No async work here — lazyConnect + ensureClient handle connection on first use.
  }

  /** True when Redis is configured and connected. */
  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.ensureClient();
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure connection before first use. */
  private async ensureClient(): Promise<Redis | null> {
    if (!this.client) return null;
    if (this.client.status !== 'ready' && this.client.status !== 'connect') {
      try {
        await this.client.connect();
      } catch {
        return null;
      }
    }
    return this.client;
  }

  // --- Geography Status ---

  async hgetallGeoStatus(key: string): Promise<Record<string, GeoStatusData>> {
    const c = await this.ensureClient();
    if (!c) return {};
    const raw = await c.hgetall(key);
    const result: Record<string, GeoStatusData> = {};
    for (const [name, json] of Object.entries(raw)) {
      try {
        result[name] = JSON.parse(json);
      } catch {
        this.logger.warn(`Failed to parse geo status for key "${key}" field "${name}"`);
      }
    }
    return result;
  }

  // --- Vote Share ---

  async getVoteShare(key: string): Promise<VoteShareData | null> {
    const c = await this.ensureClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn(`Failed to parse vote share for key "${key}"`);
      return null;
    }
  }

  // --- Undervotes ---

  async getUndervotes(key: string): Promise<UndervoteData | null> {
    const c = await this.ensureClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn(`Failed to parse undervotes for key "${key}"`);
      return null;
    }
  }

  // --- Contests ---

  async hgetallContests(): Promise<Record<string, string>> {
    const c = await this.ensureClient();
    if (!c) return {};
    return await c.hgetall('analytics:contests');
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}