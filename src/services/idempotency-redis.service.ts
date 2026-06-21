import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

/**
 * Redis-backed persistent idempotency store.
 * Falls back to in-memory Map if Redis is unavailable (development).
 *
 * KEY FORMAT: `idempotency:${idempotencyKey}` (string)
 * VALUE: JSON-serialized result object
 * TTL: configured per store (default 10 min)
 */
@Injectable()
export class IdempotencyRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IdempotencyRedisService');
  private redisClient: RedisClientType | null = null;
  private fallbackMap = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly redisUrl: string;
  private isConnected = false;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    // Default Redis URL (localhost:6379), override with REDIS_URL env var
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  }

  async onModuleInit() {
    // Attempt to connect to Redis; fail gracefully if unavailable
    try {
      this.redisClient = createClient({ url: this.redisUrl });

      this.redisClient.on('error', (err: any) => {
        this.logger.error(`[IdempotencyRedis] Connection error: ${err.message}`);
        this.isConnected = false;
      });

      this.redisClient.on('connect', () => {
        this.logger.log('[IdempotencyRedis] Connected to Redis');
        this.isConnected = true;
      });

      this.redisClient.on('disconnect', () => {
        this.logger.warn('[IdempotencyRedis] Disconnected from Redis');
        this.isConnected = false;
      });

      await this.redisClient.connect();
      this.isConnected = true;
      this.logger.log(`[IdempotencyRedis] Connected to ${this.redisUrl}`);
    } catch (error: any) {
      this.logger.warn(
        `[IdempotencyRedis] Failed to connect to Redis (${error.message}). Falling back to in-memory storage.`,
      );
      this.redisClient = null;
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.redisClient && this.isConnected) {
      try {
        await this.redisClient.quit();
        this.logger.log('[IdempotencyRedis] Disconnected from Redis');
      } catch (error: any) {
        this.logger.error(`[IdempotencyRedis] Error disconnecting: ${error.message}`);
      }
    }
  }

  /**
   * Retrieve a cached result by idempotency key.
   * Returns null if not found or expired.
   */
  async get(key: string): Promise<Record<string, unknown> | null> {
    const redisKey = `idempotency:${key}`;

    // Try Redis first
    if (this.isConnected && this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) {
          this.logger.debug(`[IdempotencyRedis] Cache HIT (Redis): ${key}`);
          return JSON.parse(cached);
        }
      } catch (error: any) {
        this.logger.warn(`[IdempotencyRedis] Error retrieving from Redis: ${error.message}. Using fallback.`);
      }
    }

    // Fallback to in-memory store
    const entry = this.fallbackMap.get(redisKey);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.fallbackMap.delete(redisKey);
      return null;
    }

    this.logger.debug(`[IdempotencyRedis] Cache HIT (Memory): ${key}`);
    return entry.value;
  }

  /**
   * Store a result with automatic TTL expiration.
   */
  async set(key: string, value: Record<string, unknown>): Promise<void> {
    const redisKey = `idempotency:${key}`;
    const jsonValue = JSON.stringify(value);

    // Try Redis first
    if (this.isConnected && this.redisClient) {
      try {
        const ttlSeconds = Math.ceil(this.ttlMs / 1000);
        await this.redisClient.setEx(redisKey, ttlSeconds, jsonValue);
        this.logger.debug(`[IdempotencyRedis] Cache SET (Redis): ${key} (TTL: ${ttlSeconds}s)`);
        return;
      } catch (error: any) {
        this.logger.warn(`[IdempotencyRedis] Error storing to Redis: ${error.message}. Using fallback.`);
      }
    }

    // Fallback to in-memory store
    this.fallbackMap.set(redisKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.logger.debug(`[IdempotencyRedis] Cache SET (Memory): ${key} (TTL: ${this.ttlMs}ms)`);
  }

  /**
   * Delete a cached entry.
   */
  async delete(key: string): Promise<void> {
    const redisKey = `idempotency:${key}`;

    if (this.isConnected && this.redisClient) {
      try {
        await this.redisClient.del(redisKey);
        this.logger.debug(`[IdempotencyRedis] Cache DELETE (Redis): ${key}`);
      } catch (error: any) {
        this.logger.warn(`[IdempotencyRedis] Error deleting from Redis: ${error.message}`);
      }
    }

    this.fallbackMap.delete(redisKey);
  }

  /**
   * Clear all cached entries (for testing/reset).
   */
  async clear(): Promise<void> {
    if (this.isConnected && this.redisClient) {
      try {
        await this.redisClient.flushDb();
        this.logger.log('[IdempotencyRedis] Flushed Redis DB');
      } catch (error: any) {
        this.logger.warn(`[IdempotencyRedis] Error flushing Redis: ${error.message}`);
      }
    }

    this.fallbackMap.clear();
    this.logger.log('[IdempotencyRedis] Cleared in-memory store');
  }

  /**
   * Check Redis connection status.
   */
  getConnectionStatus(): { connected: boolean; backend: 'redis' | 'memory' } {
    return {
      connected: this.isConnected,
      backend: this.isConnected ? 'redis' : 'memory',
    };
  }
}
