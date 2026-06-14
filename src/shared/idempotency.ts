export interface IdempotentEntry<T> {
  expiresAt: number;
  value: T;
}

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

export const InvoiceIdempotency = new IdempotencyStore<
  Record<string, unknown>
>();
