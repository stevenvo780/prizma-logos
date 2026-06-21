# Idempotency Store Migration Guide

## Overview

The `IdempotencyStore` has been migrated from in-memory `Map` storage to a persistent **Redis-backed** implementation. This ensures idempotency keys survive instance restarts and work correctly in multi-instance deployments.

## What Changed

### Before (Deprecated)
```typescript
// In-memory, lost on restart
import { InvoiceIdempotency } from '@/shared/idempotency';

const cachedResult = InvoiceIdempotency.get(key);
InvoiceIdempotency.set(key, result);
```

### After (Recommended)
```typescript
// Persistent, survives restart + multi-instance safe
import { IdempotencyRedisService } from '@/services/idempotency-redis.service';

constructor(private readonly idempotencyService: IdempotencyRedisService) {}

const cachedResult = await this.idempotencyService.get(key);
await this.idempotencyService.set(key, result);
```

## Key Differences

| Aspect | Old (InMemory) | New (Redis) |
|--------|---|---|
| **Storage** | Process memory (Map) | Redis + fallback in-memory |
| **Persistence** | Lost on restart ❌ | Survives restart ✅ |
| **Multi-instance** | Data isolated per instance ❌ | Shared across instances ✅ |
| **Async** | Synchronous | Async/await required |
| **Fallback** | N/A | Automatic in-memory if Redis unavailable |
| **TTL** | Manual cleanup in get() | Automatic Redis EXPIRE |

## Migration Steps

### 1. **Update Dependencies**
```bash
cd /workspace/Prizma/apps/logos
npm install redis@^4.6.14
```

### 2. **Update Module Imports**
In your NestJS module that uses idempotency:

```typescript
import { IdempotencyRedisService } from '@/services/idempotency-redis.service';

@Module({
  providers: [IdempotencyRedisService],
  exports: [IdempotencyRedisService],
})
export class YourModule {}
```

### 3. **Inject the Service**
```typescript
constructor(private readonly idempotencyService: IdempotencyRedisService) {}
```

### 4. **Update Usage**
Replace synchronous calls with async:

```typescript
// OLD
const cached = InvoiceIdempotency.get(key);
InvoiceIdempotency.set(key, value);

// NEW
const cached = await this.idempotencyService.get(key);
await this.idempotencyService.set(key, value);
```

### 5. **Configure Redis (Optional)**
Set `REDIS_URL` environment variable. Default: `redis://localhost:6379`

```bash
export REDIS_URL=redis://<host>:<port>
```

If Redis is unavailable, the service automatically falls back to in-memory storage (development/testing).

### 6. **Testing**
For unit tests, no changes needed — fallback in-memory store works transparently:

```typescript
describe('Idempotency', () => {
  it('should cache results', async () => {
    const service = new IdempotencyRedisService(1000); // 1s TTL
    await service.set('key', { value: 42 });
    const cached = await service.get('key');
    expect(cached).toEqual({ value: 42 });
  });
});
```

## Backward Compatibility

The old `InvoiceIdempotency` singleton is **deprecated** but still available:
- ✅ Existing tests continue to work
- ⚠️ **Not recommended for new code** — data loss risk
- ✅ Marked with `@deprecated` JSDoc comments

Recommend a phased migration:
1. New code uses `IdempotencyRedisService`
2. Gradually refactor existing usage
3. Eventually remove `InvoiceIdempotency` import

## Monitoring

Check Redis connection status:
```typescript
const status = this.idempotencyService.getConnectionStatus();
// { connected: true, backend: 'redis' }
// or { connected: false, backend: 'memory' }
```

Logs will show:
- `[IdempotencyRedis] Connected to redis://...`
- `[IdempotencyRedis] Cache HIT (Redis): <key>`
- `[IdempotencyRedis] Cache SET (Redis): <key> (TTL: 600s)`
- If Redis unavailable: falls back with `[IdempotencyRedis] ... Using fallback.`

## TTL Configuration

By default, idempotency keys expire after **10 minutes** (600 seconds).

To change TTL when creating the service:
```typescript
// 30 minutes TTL
const service = new IdempotencyRedisService(30 * 60 * 1000);
```

## Production Checklist

- [ ] Redis instance running and accessible
- [ ] `REDIS_URL` environment variable configured
- [ ] Network connectivity verified (firewall rules, credentials)
- [ ] Monitor Redis memory usage (keys have automatic expiration)
- [ ] Verify logs show `[IdempotencyRedis] Connected to Redis`
- [ ] Test failover behavior (disable Redis, verify fallback to in-memory)
- [ ] Load test with expected concurrency

## Troubleshooting

### Redis Connection Fails
```
[IdempotencyRedis] Failed to connect to Redis (...). Falling back to in-memory storage.
```
- **Cause**: Redis unavailable or wrong URL
- **Action**: Check `REDIS_URL`, verify Redis is running
- **Workaround**: Service continues with in-memory fallback (data lost on restart)

### Cache Misses on Multi-Instance
- **Cause**: Instances still using old in-memory store
- **Action**: Ensure all instances are using `IdempotencyRedisService`
- **Verify**: Check logs for `backend: 'redis'` on all instances

### Memory Growth
- **Cause**: Old in-memory map growing unbounded
- **Action**: Ensure Redis is connected (check logs for `Connected to Redis`)
- **Verify**: Run `redis-cli INFO memory` to check Redis size

## See Also

- `/workspace/Prizma/apps/logos/src/services/idempotency-redis.service.ts` — Implementation
- `/workspace/Prizma/apps/logos/src/modules/invoices/invoices.controller.ts` — Usage example
- Redis documentation: https://redis.io/docs/
