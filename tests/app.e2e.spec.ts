import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror production settings that affect routing/validation
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: false,
        forbidUnknownValues: false,
        transform: true,
        validateCustomDecorators: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const authHeaders = {
    'x-email': 'tester@example.com',
    'x-api-key': 'abc:123',
  };

  it('GET /api should return API metadata', async () => {
    const res = await request(app.getHttpServer())
      .get('/api')
      .set(authHeaders)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        name: expect.any(String),
        version: expect.any(String),
        environment: expect.any(String),
        endpoints: expect.objectContaining({ invoices: '/api/invoices' }),
        documentation: '/api/docs',
      }),
    );
  });

  it('GET /api/docs should describe endpoints and schemas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs')
      .set(authHeaders)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        documentation: expect.any(Object),
        schemas: expect.any(Object),
      }),
    );
  });
});

