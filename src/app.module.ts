import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SigoCredentialsMiddleware } from './middleware-nest/sigo-credentials.middleware';
import { IdempotencyRedisService } from './services/idempotency-redis.service';

@Module({
  imports: [InvoicesModule],
  controllers: [AppController],
  providers: [IdempotencyRedisService],
  exports: [IdempotencyRedisService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SigoCredentialsMiddleware).forRoutes('*');
  }
}
