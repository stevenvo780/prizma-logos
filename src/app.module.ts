import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SigoCredentialsMiddleware } from './middleware-nest/sigo-credentials.middleware';

@Module({
  imports: [InvoicesModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SigoCredentialsMiddleware).forRoutes('*');
  }
}
