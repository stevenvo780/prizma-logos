import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // Olympo-standard liveness probe. Excluded from the global `api` prefix in
  // index.ts, so it is served at bare `/health` (ARCHITECTURE.md §3 registry).
  @Get('health')
  health() {
    return { status: 'healthy', service: 'apisigo' };
  }

  @Get()
  root() {
    return {
      success: true,
      name: 'SIGO POS API',
      description:
        'API para integración con SIGO POS - Facturación electrónica para Colombia',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      endpoints: {
        invoices: '/api/invoices',
      },
      documentation: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('docs')
  docs() {
    return {
      success: true,
      documentation: {
        invoices: {
          'POST /api/invoices': 'Crear nueva factura',
          'POST /api/invoices/webhook': 'Crear factura desde webhook',
          'POST /api/invoices/:serie/:numero/cancel':
            'Anular factura (crear nota de crédito)',
        },
      },
      schemas: {
        invoice: {
          serie: 'string',
          numero: 'number',
          fechaEmision: 'string (ISO 8601)',
          cliente: {
            tipoDocumento: 'RUC|NIT|CC|DNI|CE',
            numeroDocumento: 'string',
            razonSocial: 'string',
            email: 'string (optional)',
            telefono: 'string (optional)',
          },
          items: [
            {
              descripcion: 'string',
              cantidad: 'number',
              precioUnitario: 'number',
            },
          ],
          totales: {
            subtotal: 'number',
            impuestos: 'number',
            total: 'number',
          },
        },
      },
    };
  }
}
