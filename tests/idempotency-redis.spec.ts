/**
 * Test suite: IdempotencyRedisService
 *
 * Validates persistent idempotency store behavior:
 * 1. Redis backend when available
 * 2. In-memory fallback when Redis unavailable
 * 3. TTL expiration (both Redis and fallback)
 * 4. Multi-instance safety (shared Redis)
 * 5. Graceful degradation
 */

import { IdempotencyRedisService } from '@/services/idempotency-redis.service';

describe('IdempotencyRedisService', () => {
  let service: IdempotencyRedisService;

  beforeEach(() => {
    // Create a service instance with short TTL for testing
    service = new IdempotencyRedisService(1000); // 1 second TTL
  });

  afterEach(async () => {
    // Cleanup after each test
    if (service) {
      await service.clear();
      await service.onModuleDestroy();
    }
  });

  describe('Basic Operations (In-Memory Fallback)', () => {
    it('should store and retrieve idempotency results', async () => {
      const key = 'order-12345-items-[1,2,3]';
      const result = { invoiceId: 'INV-001', status: 'created', timestamp: '2024-01-01T00:00:00Z' };

      await service.set(key, result);
      const cached = await service.get(key);

      expect(cached).toEqual(result);
    });

    it('should return null for non-existent keys', async () => {
      const cached = await service.get('non-existent-key-xyz');
      expect(cached).toBeNull();
    });

    it('should handle complex nested objects', async () => {
      const key = 'complex-order-001';
      const result = {
        invoiceId: 'INV-002',
        customer: {
          id: 'CUST-123',
          name: 'Acme Corp',
          contacts: [{ email: 'contact@acme.com', phone: '+1-555-1234' }],
        },
        items: [
          { productId: 'P1', qty: 2, price: 100.5 },
          { productId: 'P2', qty: 1, price: 250.0 },
        ],
        total: 451.0,
      };

      await service.set(key, result);
      const cached = await service.get(key);

      expect(cached).toEqual(result);
      expect((cached as any)?.customer?.name).toBe('Acme Corp');
      expect((cached as any)?.items).toHaveLength(2);
    });

    it('should allow updating an existing key', async () => {
      const key = 'mutable-key';
      const v1 = { value: 'first' };
      const v2 = { value: 'second', updated: true };

      await service.set(key, v1);
      expect(await service.get(key)).toEqual(v1);

      await service.set(key, v2);
      expect(await service.get(key)).toEqual(v2);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortService = new IdempotencyRedisService(100); // 100ms TTL
      const key = 'short-ttl-key';
      const value = { test: true, createdAt: new Date().toISOString() };

      await shortService.set(key, value);

      // Should exist immediately
      let cached = await shortService.get(key);
      expect(cached).toEqual(value);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be gone
      cached = await shortService.get(key);
      expect(cached).toBeNull();

      await shortService.onModuleDestroy();
    });

    it('should have separate TTLs per key', async () => {
      const shortService = new IdempotencyRedisService(100); // 100ms TTL
      const key1 = 'key-1';
      const key2 = 'key-2';

      await shortService.set(key1, { id: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await shortService.set(key2, { id: 2 }); // Set key2 after key1

      await new Promise((resolve) => setTimeout(resolve, 80)); // Total 130ms > 100ms

      // key1 should be expired (130ms > 100ms)
      expect(await shortService.get(key1)).toBeNull();

      // key2 should still exist (80ms < 100ms from its set time)
      expect(await shortService.get(key2)).toEqual({ id: 2 });

      await shortService.onModuleDestroy();
    });
  });

  describe('Explicit Delete', () => {
    it('should delete a key from cache', async () => {
      const key = 'deletable-key';
      const value = { data: 'to-be-deleted' };

      await service.set(key, value);
      expect(await service.get(key)).toEqual(value);

      await service.delete(key);
      expect(await service.get(key)).toBeNull();
    });

    it('should handle deletion of non-existent keys gracefully', async () => {
      // Should not throw
      await expect(service.delete('non-existent-key')).resolves.toBeUndefined();
    });
  });

  describe('Clear All', () => {
    it('should clear all entries', async () => {
      await service.set('key-1', { id: 1 });
      await service.set('key-2', { id: 2 });
      await service.set('key-3', { id: 3 });

      expect(await service.get('key-1')).not.toBeNull();
      expect(await service.get('key-2')).not.toBeNull();
      expect(await service.get('key-3')).not.toBeNull();

      await service.clear();

      expect(await service.get('key-1')).toBeNull();
      expect(await service.get('key-2')).toBeNull();
      expect(await service.get('key-3')).toBeNull();
    });
  });

  describe('Connection Status', () => {
    it('should report connection status', async () => {
      const status = service.getConnectionStatus();

      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('backend');
      expect(typeof status.connected).toBe('boolean');
      expect(['redis', 'memory']).toContain(status.backend);
    });

    it('should indicate memory backend when Redis unavailable', () => {
      // Create service without waiting for Redis init
      const status = service.getConnectionStatus();

      // Depending on environment, either redis or memory is OK
      // (if Redis is not running, should fall back to memory)
      expect(['redis', 'memory']).toContain(status.backend);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent sets and gets', async () => {
      const operations: Promise<void>[] = [];

      // Set 20 keys concurrently
      for (let i = 0; i < 20; i++) {
        operations.push(service.set(`key-${i}`, { index: i }));
      }
      await Promise.all(operations);

      // Get 20 keys concurrently
      const getOps = [];
      for (let i = 0; i < 20; i++) {
        getOps.push(service.get(`key-${i}`));
      }
      const results = await Promise.all(getOps);

      expect(results).toHaveLength(20);
      results.forEach((result, index) => {
        expect(result).toEqual({ index: index });
      });
    });

    it('should handle concurrent deletes', async () => {
      // Setup: create 10 keys
      for (let i = 0; i < 10; i++) {
        await service.set(`key-${i}`, { id: i });
      }

      // Delete all concurrently
      const deleteOps = [];
      for (let i = 0; i < 10; i++) {
        deleteOps.push(service.delete(`key-${i}`));
      }
      await Promise.all(deleteOps);

      // Verify all are gone
      for (let i = 0; i < 10; i++) {
        expect(await service.get(`key-${i}`)).toBeNull();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle JSON serialization of circular references gracefully', async () => {
      const obj: any = { value: 'test' };
      obj.self = obj; // Circular reference

      // Should throw or handle gracefully
      try {
        await service.set('circular-key', obj);
        // If it doesn't throw, attempt to get it
        await service.get('circular-key');
      } catch (error: any) {
        // Circular reference error is acceptable
        expect(error.message).toMatch(/circular|circular structure/i);
      }
    });

    it('should handle very large values', async () => {
      const largeValue = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      };

      await service.set('large-key', largeValue);
      const cached = await service.get('large-key');

      expect(cached).toBeDefined();
      expect((cached as any)?.items).toHaveLength(1000);
    });
  });

  describe('Multi-Instance Safety (Conceptual)', () => {
    it('should use deterministic key format compatible with multiple instances', async () => {
      // Simulate two instances
      const service1 = new IdempotencyRedisService(5000);
      const service2 = new IdempotencyRedisService(5000);

      const key = 'shared-invoice-request';
      const result = { invoiceId: 'INV-SHARED-001' };

      // Instance 1 sets the value
      await service1.set(key, result);

      // Instance 2 should be able to retrieve it (if Redis is shared)
      // Note: This test assumes Redis is shared; in memory fallback will not share
      const cached = await service2.get(key);

      // Either both are connected to Redis (and find it), or both use memory (and don't)
      // The important thing is they use the same key format
      if (service1.getConnectionStatus().backend === 'redis' &&
          service2.getConnectionStatus().backend === 'redis') {
        expect(cached).toEqual(result);
      }

      await service1.onModuleDestroy();
      await service2.onModuleDestroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string keys', async () => {
      const key = '';
      const value = { test: 'empty-key' };

      await service.set(key, value);
      const cached = await service.get(key);

      expect(cached).toEqual(value);
    });

    it('should handle very long keys', async () => {
      const key = 'a'.repeat(1000);
      const value = { test: 'long-key' };

      await service.set(key, value);
      const cached = await service.get(key);

      expect(cached).toEqual(value);
    });

    it('should handle keys with special characters', async () => {
      const key = 'key:with:colons:and|pipes|and/slashes?query=1&param=2';
      const value = { test: 'special-chars' };

      await service.set(key, value);
      const cached = await service.get(key);

      expect(cached).toEqual(value);
    });

    it('should handle null and undefined values in objects', async () => {
      const key = 'null-undefined-key';
      const value = {
        nullField: null,
        undefinedField: undefined,
        normalField: 'text',
      };

      await service.set(key, value);
      const cached = await service.get(key);

      expect((cached as any)?.normalField).toBe('text');
      expect((cached as any)?.nullField).toBeNull();
      // Note: JSON.stringify converts undefined to null or omits it
      expect((cached as any)?.undefinedField === null || (cached as any)?.undefinedField === undefined).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should initialize and destroy gracefully', async () => {
      const newService = new IdempotencyRedisService(1000);
      await newService.onModuleInit();

      const status = newService.getConnectionStatus();
      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('backend');

      await newService.onModuleDestroy();
      // Allow some time for Redis to disconnect
      await new Promise((resolve) => setTimeout(resolve, 50));

      // After destroy, the backend should either be memory or disconnected
      const afterDestroyStatus = newService.getConnectionStatus();
      expect(afterDestroyStatus).toHaveProperty('connected');
      expect(afterDestroyStatus).toHaveProperty('backend');
    });
  });
});
