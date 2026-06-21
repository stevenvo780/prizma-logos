import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InvoicesController } from './invoices.controller';
import { InvoiceService } from './invoices.service';
import { RetryOnAuthErrorInterceptor } from '@/middleware-nest/retry-on-auth-error.interceptor';
import { IdempotencyRedisService } from '@/services/idempotency-redis.service';

@Module({
  controllers: [InvoicesController],
  providers: [
    InvoiceService,
    IdempotencyRedisService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RetryOnAuthErrorInterceptor,
    },
  ],
  exports: [InvoiceService, IdempotencyRedisService],
})
export class InvoicesModule {}
