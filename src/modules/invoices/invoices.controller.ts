import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceService } from './invoices.service';
import { Request } from 'express';
import { CreateInvoiceFromOrderDto } from './dto/create-invoice-from-order.dto';
import { IdempotencyRedisService } from '@/services/idempotency-redis.service';
import { createHash } from 'crypto';

interface RequestWithSigo extends Request {
  sigoAuthHeaders?: { Authorization: string; 'Partner-Id': string };
}

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly idempotencyService: IdempotencyRedisService,
  ) {}

  /**
   * Generate a deterministic idempotency key for an order/invoice
   */
  private getIdempotencyKey(event: Record<string, unknown>): string {
    const key = `${event.orderId || event.id}:${JSON.stringify(event.items || [])}`;
    return createHash('sha256').update(key).digest('hex');
  }

  @Get('__health')
  health() {
    return { ok: true, scope: 'invoices-router' };
  }

  @Get('payment-types')
  async getPaymentTypes(@Req() req: RequestWithSigo, @Query('document_type') documentType = 'FV') {
    const paymentTypes = await this.invoiceService.getPaymentTypes(req.sigoAuthHeaders!, documentType);
    return {
      success: true,
      data: paymentTypes,
      message: `Métodos de pago disponibles para documento tipo ${documentType}`,
    };
  }

  @Get('sellers')
  async getSellers(@Req() req: RequestWithSigo) {
    const sellers = await this.invoiceService.getSellersList(req.sigoAuthHeaders!);
    return { success: true, data: sellers };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: RequestWithSigo, @Body() dto: CreateInvoiceDto) {
    const authEmail = (req as any)?.sigoCredentials?.email || (req.headers['x-email'] as string) || undefined;
    try {
      const result = await this.invoiceService.createInvoice(dto as any, req.sigoAuthHeaders!, undefined, authEmail);
      return { success: true, message: 'Factura creada exitosamente', data: result };
    } catch (e: any) {
      throw e;
    }
  }

  @Post('from-order')
  @HttpCode(HttpStatus.CREATED)
  async createFromOrder(@Req() req: RequestWithSigo, @Body() order: CreateInvoiceFromOrderDto) {
    const dto = this.invoiceService.convertOrderToInvoice(order as any);
    const authEmail = (req as any)?.sigoCredentials?.email || (req.headers['x-email'] as string) || undefined;
    try {
      const result = await this.invoiceService.createInvoice(dto as any, req.sigoAuthHeaders!, undefined, authEmail);
      return { success: true, message: 'Factura creada desde orden', data: result };
    } catch (e: any) {
      throw e;
    }
  }

  /**
   * POST /api/invoices/from-event — conector Nous.
   * Recibe un evento de facturación desde Nous y delega al endpoint from-order existente.
   * Payload canónico: { eventType, orderId, orderData, metadata }
   */
  @Post('from-event')
  @HttpCode(HttpStatus.CREATED)
  async createFromEvent(@Req() req: RequestWithSigo, @Body() event: Record<string, unknown>) {
    const logger = (this as any).logger || { log: console.log };
    logger.log?.(`[nous] invoice/from-event: eventType=${event.eventType} orderId=${event.orderId}`);

    // Si no hay credenciales SIGO, este endpoint funciona como sink Nous:
    // acepta el evento y deja la emisión real para un worker/config posterior.
    if (!req.sigoAuthHeaders) {
      return {
        success: true,
        message: 'Evento de facturación recibido desde Nous — SIGO no configurado para emisión inmediata',
        eventType: event.eventType || 'invoice.create',
        orderId: event.orderId || (event as any).id || 'unknown',
        timestamp: new Date().toISOString(),
      };
    }

    // Si el evento contiene orderData, delegar a from-order
    const orderData = (event.orderData || event.data || event) as any;
    if (orderData.orderId || orderData.id) {
      // Map Nous event shape to convertOrderToInvoice expected shape
      // Nous sends: { sku, name, qty, unitPrice }
      // convertOrderToInvoice expects: { product: { id, title, code }, quantity, finalPrice }
      const mappedItems = Array.isArray(orderData.items)
        ? orderData.items.map((item: any) => ({
            product: {
              id: item.product?.id || item.productId || 0,
              title: item.product?.name || item.name || item.product?.title || 'Sin nombre',
              code: item.product?.code || item.sku || undefined,
            },
            quantity: Number(item.quantity || item.qty || 0),
            finalPrice: Number(item.price || item.unitPrice || item.finalPrice || 0),
          }))
        : [];

      // Check idempotency: if this event was already processed, return cached result
      const idempotencyKey = this.getIdempotencyKey(orderData);
      const cachedResult = await this.idempotencyService.get(idempotencyKey);
      if (cachedResult) {
        logger.log?.(`[nous] invoice/from-event: idempotent retry detected (key: ${idempotencyKey})`);
        return { success: true, message: 'Factura ya creada (resultado en caché)', data: cachedResult };
      }

      const dto = this.invoiceService.convertOrderToInvoice({
        id: Number(orderData.orderId || orderData.id || 0),
        store: orderData.store ? { name: orderData.store?.name || orderData.store } : undefined,
        customer: orderData.customer
          ? {
              documentNumber: orderData.customer?.identification || orderData.customer?.documentNumber,
              name: orderData.customer?.name,
              email: orderData.customer?.email,
              phone: orderData.customer?.phone,
            }
          : undefined,
        user: orderData.user
          ? {
              documentNumber: orderData.user?.documentNumber || orderData.user?.identification,
              name: orderData.user?.name,
              email: orderData.user?.email,
            }
          : undefined,
        items: mappedItems,
      } as any);
      const authEmail = (req as any)?.sigoCredentials?.email || (req.headers['x-email'] as string) || undefined;
      const result = await this.invoiceService.createInvoice(dto as any, req.sigoAuthHeaders!, undefined, authEmail);

      // Store result in persistent Redis-backed idempotency cache
      await this.idempotencyService.set(idempotencyKey, result);

      return { success: true, message: 'Factura creada desde evento Nous', data: result };
    }

    // Sin orderData: devolver ACK y loguear (el evento llegó pero sin datos facturables)
    return {
      success: true,
      message: 'Evento recibido sin datos facturables — logueado',
      eventType: event.eventType || 'unknown',
      orderId: event.orderId || 'unknown',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('cancel/:serie/:numero')
  @HttpCode(HttpStatus.CREATED)
  async cancel(
    @Req() req: RequestWithSigo,
    @Param('serie') serie: string,
    @Param('numero') numero: string,
    @Body('motivo') motivo?: string,
  ) {
    const data = await this.invoiceService.createCreditNoteByInvoiceNumber(serie, numero, req.sigoAuthHeaders!, motivo);
    return { success: true, message: 'Nota de crédito creada para anulación', data };
  }
}
