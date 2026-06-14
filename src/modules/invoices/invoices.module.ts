import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InvoicesController } from './invoices.controller';
import { InvoiceService } from './invoices.service';
import { RetryOnAuthErrorInterceptor } from '@/middleware-nest/retry-on-auth-error.interceptor';

@Module({
  controllers: [InvoicesController],
  providers: [
    InvoiceService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RetryOnAuthErrorInterceptor,
    },
  ],
  exports: [InvoiceService],
})
export class InvoicesModule {}
