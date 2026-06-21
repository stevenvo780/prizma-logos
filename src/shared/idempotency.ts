/**
 * @deprecated Use IdempotencyRedisService from @/services/idempotency-redis.service instead.
 * This in-memory implementation is retained for backward compatibility and testing only.
 * It is NOT suitable for multi-instance deployments as data is lost on restart.
 */
export interface IdempotentEntry<T> {
  expiresAt: number;
  value: T;
}

/**
 * @deprecated Use IdempotencyRedisService instead.
 * In-memory idempotency store for single-instance deployments or testing.
 * Data is lost on restart/crash.
 */
export class IdempotencyStore<T = Record<string, unknown>> {
  private map = new Map<string, IdempotentEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/**
 * @deprecated Use IdempotencyRedisService instead.
 * In-memory singleton instance retained for backward compatibility with existing code.
 */
export const InvoiceIdempotency = new IdempotencyStore<
  Record<string, unknown>
>();
