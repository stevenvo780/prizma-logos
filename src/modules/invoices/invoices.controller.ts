import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceService } from './invoices.service';
import { Request } from 'express';
import { CreateInvoiceFromOrderDto } from './dto/create-invoice-from-order.dto';

interface RequestWithSigo extends Request {
  sigoAuthHeaders?: { Authorization: string; 'Partner-Id': string };
}

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoiceService: InvoiceService) {}

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
    const sellers = await (this.invoiceService as any).getSellersList?.(req.sigoAuthHeaders!)
      ?? { results: await (this.invoiceService as any)['listSellers']?.(req.sigoAuthHeaders!) };
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
