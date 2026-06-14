import { InvoiceService } from '../src/modules/invoices/invoices.service';

describe('InvoiceService.getPaymentTypes', () => {
  let service: InvoiceService;

  const authHeaders = {
    Authorization: 'Bearer TEST',
    'Partner-Id': 'PARTNER-TEST',
  } as any;

  beforeEach(() => {
    service = new InvoiceService();
  });

  it('should request /v1/payment-types with document_type and return data object', async () => {
    const mockData = { results: [{ id: 451, name: 'Efectivo', active: true }] };
    // @ts-ignore override private
    service['client'] = { get: jest.fn().mockResolvedValue({ data: mockData }) } as any;

    const out = await service.getPaymentTypes(authHeaders, 'FV');
    expect(out).toEqual(mockData);
    expect((service as any).client.get).toHaveBeenCalledWith('/v1/payment-types?document_type=FV', { headers: authHeaders });
  });

  it('should pass through array payloads as-is', async () => {
    const mockArray = [{ id: 1, name: 'Efectivo' }];
    // @ts-ignore override private
    service['client'] = { get: jest.fn().mockResolvedValue({ data: mockArray }) } as any;

    const out = await service.getPaymentTypes(authHeaders, 'FV');
    expect(out).toEqual(mockArray as any);
    expect((service as any).client.get).toHaveBeenCalledWith('/v1/payment-types?document_type=FV', { headers: authHeaders });
  });
});
