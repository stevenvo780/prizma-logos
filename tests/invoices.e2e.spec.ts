import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { InvoiceService } from '../src/modules/invoices/invoices.service';

describe('InvoicesController (e2e)', () => {
  let app: INestApplication;

  const mockInvoiceService: Partial<Record<keyof InvoiceService, any>> = {
    getPaymentTypes: jest.fn().mockResolvedValue({ results: [{ id: 1, name: 'Efectivo', active: true }] }),
    getSellersList: jest.fn().mockResolvedValue({ results: [{ id: 10, email: 'seller@example.com', username: 'seller', is_seller: true }] }),
    createInvoice: jest.fn().mockResolvedValue({ id: 'INV-1001', number: 'FV-1001' }),
    convertOrderToInvoice: jest.fn().mockReturnValue({
      date: '2025-01-01',
      customer: { identification: '123456789', branch_office: 0 },
      items: [{ code: 'P1', description: 'Prod 1', quantity: 1, price: 100 }],
      observations: 'Desde orden',
    }),
    createCreditNoteByInvoiceNumber: jest.fn().mockResolvedValue({ id: 'CN-2001', number: 'NC-2001' }),
  } as any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InvoiceService)
      .useValue(mockInvoiceService)
      .compile();

    app = moduleRef.createNestApplication();
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

  it('GET /api/invoices/__health should respond ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/invoices/__health')
      .set(authHeaders)
      .expect(200);
    expect(res.body).toEqual({ ok: true, scope: 'invoices-router' });
  });

  it('GET /api/invoices/payment-types should return types', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/invoices/payment-types?document_type=FV')
      .set(authHeaders)
      .expect(200);
    expect(mockInvoiceService.getPaymentTypes).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    if (res.body.data !== undefined) {
      expect(typeof res.body.data).toMatch(/object/);
    }
  });

  it('GET /api/invoices/sellers should return sellers list', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/invoices/sellers')
      .set(authHeaders)
      .expect(200);
    expect(mockInvoiceService.getSellersList).toHaveBeenCalled();
    expect(res.body).toEqual(expect.objectContaining({ success: true, data: expect.any(Object) }));
  });

  it('POST /api/invoices should create an invoice', async () => {
    const payload = {
      customer: { identification: '123456789', branch_office: 0 },
      items: [{ code: 'P1', description: 'Prod 1', quantity: 1, price: 100 }],
      observations: 'test',
    };
    const res = await request(app.getHttpServer())
      .post('/api/invoices')
      .set(authHeaders)
      .send(payload)
      .expect(201);
    expect(mockInvoiceService.createInvoice).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    if (res.body.data !== undefined) {
      expect(typeof res.body.data).toBe('object');
    }
  });

  it('POST /api/invoices/from-order should convert and create invoice', async () => {
    const order = {
      id: 99,
      store: { id: 'S1', name: 'Main' },
      customer: { documentNumber: '987654321', name: 'John', email: 'john@example.com' },
      items: [
        { product: { id: 10, title: 'Prod A', code: 'A-10' }, quantity: 2, finalPrice: 50 },
      ],
    };
    const res = await request(app.getHttpServer())
      .post('/api/invoices/from-order')
      .set(authHeaders)
      .send(order)
      .expect(201);
    expect(mockInvoiceService.convertOrderToInvoice).toHaveBeenCalled();
    expect(mockInvoiceService.createInvoice).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    if (res.body.data !== undefined) {
      expect(typeof res.body.data).toBe('object');
    }
  });

  it('POST /api/invoices/cancel/:serie/:numero should create credit note', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/invoices/cancel/FV/1001')
      .set(authHeaders)
      .send({ motivo: 'Error en factura' })
      .expect(201);
    // Ensure it was called with serie and numero; headers argument may be undefined in test context
    expect(mockInvoiceService.createCreditNoteByInvoiceNumber).toHaveBeenCalled();
    const call = (mockInvoiceService.createCreditNoteByInvoiceNumber as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('FV');
    expect(call[1]).toBe('1001');
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    if (res.body.data !== undefined) {
      expect(typeof res.body.data).toBe('object');
    }
  });
});
