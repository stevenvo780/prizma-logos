import { Injectable } from '@nestjs/common';
import axios from 'axios';
type AxiosInstance = ReturnType<typeof axios.create>;
type AxiosRequestConfig = any;
type AxiosResponse = any;
type AxiosError = any;
import type { SigoAuthHeaders } from '@/services/sigoAuthService';
import http from 'http';
import https from 'https';
import { publishInvoiceSent } from '@/cauce/hub';

export interface CreateClientData {
  tipoDocumento: 'RUC' | 'DNI' | 'CE' | 'NIT' | 'CC';
  numeroDocumento: string;
  razonSocial: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  activo?: boolean;
}

interface CustomerForInvoice {
  identification: string;
  branch_office?: number;
}

export interface InvoiceItem {
  code: string;
  description: string;
  quantity: number;
  price: number;
  discount?: number;
  taxes?: Array<{ id: number }>;
}

export interface InvoicePayment {
  id: number;
  value: number;
  due_date: string;
}

export interface CreateInvoiceData {
  date?: string;
  customer: CustomerForInvoice;
  customerData?: CreateClientData;
  items: InvoiceItem[];
  payments?: InvoicePayment[];
  observations?: string;
}

@Injectable()
export class InvoiceService {
  private client: AxiosInstance;
  private static readonly TTL_MS = 5 * 60 * 1000;
  private static paymentTypesCache = new Map<string, { items: any[]; exp: number }>();
  private static sellersCache = new Map<string, { items: any[]; exp: number }>();
  private static taxesCache = new Map<string, { items: any[]; exp: number }>();

  constructor() {
    const baseURL = process.env.SIIGO_API_URL || process.env.SIGO_API_URL || process.env.SIGO_BASE_URL || process.env.SIIGO_BASE_URL;
    const timeout = parseInt(process.env.SIIGO_TIMEOUT || process.env.SIGO_TIMEOUT || '60000', 10);
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true });
    this.client = axios.create({ baseURL, timeout, httpAgent, httpsAgent } as any);

    this.client.interceptors.request.use((config: AxiosRequestConfig) => {
      (config as any).meta = { start: Date.now() };
      try {
        const isInv = String(config.url).includes('/v1/invoices') && String(config.method).toLowerCase() === 'post';
        if (isInv) {
          const body = (config as any).data;
          const items = Array.isArray(body?.items) ? body.items.length : 0;
          const hasTaxes = !!(body?.items || []).some((it: any) => Array.isArray(it?.taxes) && it.taxes.length);
          const sellerShapes = {
            rootSeller: typeof body?.seller,
            rootSellerId: typeof body?.seller_id,
            docSeller: typeof body?.document?.seller,
            docSellerId: typeof body?.document?.seller_id,
          };
          console.log('[SIGO] → POST /v1/invoices', { items, hasTaxes, sellerShapes });
        }
      } catch { }
      return config;
    });
    
    this.client.interceptors.response.use(
      (res: AxiosResponse) => {
        const start = (res.config as any).meta?.start || Date.now();
        const ms = Date.now() - start;
        try {
          if (String(res.config.url).includes('/v1/invoices') && String(res.config.method).toLowerCase() === 'post') {
            console.log('[SIGO] ← /v1/invoices OK', { status: res.status, ms });
          }
        } catch { }
        return res;
      },
      (err: AxiosError) => {
        const cfg = err?.config || {};
        const start = (cfg as any).meta?.start || Date.now();
        const ms = Date.now() - start;
        const status = (err && (err as any).response) ? (err as any).response.status : undefined;
        const url = (cfg as any)?.url;
        const msg = (err as any)?.response?.data?.Errors?.[0]?.Message || (err as any)?.message;
        console.error('[SIGO] × request error', { url, status, ms, msg });
        return Promise.reject(err);
      },
    );
  }

  public async getSellersList(authHeaders: SigoAuthHeaders) {
    const items = await this.listUsersSellerCatalog(authHeaders);
    const slim = items.map((u: any) => ({ id: Number(u.id), email: u.email, username: u.username, is_seller: u.is_seller, roles: u.roles }));
    return { results: slim } as any;
  }

  async findCustomerByIdentification(
    identification: string,
    authHeaders: SigoAuthHeaders,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.client.get(
        `/v1/customers?identification=${encodeURIComponent(identification)}`,
        { headers: authHeaders },
      );
      const results: unknown = (response as { data?: { results?: unknown } }).data?.results || [];
      return Array.isArray(results) && results.length > 0 && typeof results[0] === 'object'
        ? (results[0] as Record<string, unknown>)
        : null;
    } catch (error) {
      return null;
    }
  }

  async createCustomer(
    data: CreateClientData,
    authHeaders: SigoAuthHeaders,
  ): Promise<Record<string, unknown>> {
    const sigoPayload = this.buildSiigoCustomerPayload(data);
    const response = await this.client.post('/v1/customers', sigoPayload, {
      headers: authHeaders,
    });
    return (response as { data: Record<string, unknown> }).data;
  }

  private mapTipoDocumentoToIdType(tipo: string): number {
    const map: Record<string, number> = {
      NIT: 31,
      CC: 13,
      CE: 22,
      DNI: 13,
      RUC: 41,
    };
    return map[tipo] || 31;
  }

  private mapPersonType(tipo: string): 'Company' | 'Person' {
    return tipo === 'NIT' || tipo === 'RUC' ? 'Company' : 'Person';
  }

  private buildSiigoCustomerPayload(data: CreateClientData) {
    const nombreCompleto = data.razonSocial.trim();
    const isCompany = this.mapPersonType(data.tipoDocumento) === 'Company';
    const palabras = nombreCompleto.split(' ');

    const sanitize = (s: string) => s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').toUpperCase();
    const nombre = isCompany
      ? sanitize(palabras[0] || nombreCompleto) || 'EMPRESA'
      : palabras[0] || nombreCompleto;
    const apellido = isCompany
      ? sanitize(palabras[1] || 'SOCIEDAD') || 'SOCIEDAD'
      : palabras.slice(1).join(' ') || nombre;

    return {
      type: 'Customer',
      person_type: this.mapPersonType(data.tipoDocumento),
      id_type: this.mapTipoDocumentoToIdType(data.tipoDocumento).toString(),
      identification: data.numeroDocumento,
      name: [nombre, apellido],
      commercial_name: data.razonSocial,
      active: data.activo !== undefined ? data.activo : true,
      vat_responsible: false,
      fiscal_responsibilities: [{ code: 'R-99-PN' }],
      address: data.direccion
        ? {
          address: data.direccion,
        }
        : undefined,
      phones: data.telefono ? [{ indicative: '57', number: data.telefono }] : undefined,
      contacts: data.email
        ? [
          {
            first_name: nombre,
            last_name: apellido,
            email: data.email,
            phone: data.telefono ? { indicative: '57', number: data.telefono } : undefined,
          },
        ]
        : undefined,
    };
  }

  private async listPaymentTypes(authHeaders: SigoAuthHeaders, documentType: string = 'FV') {
    const key = `${authHeaders['Partner-Id']}::${documentType}`;
    const now = Date.now();
    const cached = InvoiceService.paymentTypesCache.get(key);
    if (cached && cached.exp > now) return cached.items;
    const res = await this.client.get(`/v1/payment-types?document_type=${documentType}`, { headers: authHeaders });
    const items: any = (res as any).data?.results || (res as any).data || [];
    const arr = Array.isArray(items) ? items : [];
    InvoiceService.paymentTypesCache.set(key, { items: arr, exp: now + InvoiceService.TTL_MS });
    return arr;
  }


  private async listUsersSellerCatalog(authHeaders: SigoAuthHeaders) {
    const key = `${authHeaders['Partner-Id']}::users-sellers`;
    const now = Date.now();
    const cached = InvoiceService.sellersCache.get(key);
    if (cached && cached.exp > now) return cached.items;

    const res = await this.client.get(`/v1/users`, { headers: authHeaders });
    const raw: any = (res as any).data;
    const arr: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.results) ? raw.results : []);
    const isSeller = (u: any) => u?.is_seller === true || (Array.isArray(u?.roles) && u.roles.some((r: any) => String(r).toLowerCase() === 'seller'));
    const sellers = arr.filter(isSeller);
    const items = sellers.length > 0 ? sellers : arr;

    InvoiceService.sellersCache.set(key, { items, exp: now + InvoiceService.TTL_MS });
    return items;
  }

  private async resolveSellerId(authHeaders: SigoAuthHeaders, emailHint?: string): Promise<number | undefined> {
    const envPrimary = process.env.SIIGO_SELLER_ID ? parseInt(process.env.SIIGO_SELLER_ID, 10) : undefined;
    try {
      const users = await this.listUsersSellerCatalog(authHeaders);
      const norm = (s?: string) => (s || '').trim().toLowerCase();
      const hint = norm(emailHint);
      let matched: any | undefined;
      if (hint) {
        matched = users.find((u: any) => norm(u?.email) === hint || norm(u?.username) === hint);
      }
      const pick = matched && (matched.active ?? true) ? matched : users.find((u: any) => (u?.is_seller === true) || (Array.isArray(u?.roles) && u.roles.some((r: any) => String(r).toLowerCase() === 'seller')));
      const firstActive = users.find((u: any) => u && (u.active ?? true));
      const idFromApi = pick?.id ? Number(pick.id) : (firstActive?.id ? Number(firstActive.id) : undefined);
      if (idFromApi) return idFromApi;
      return envPrimary ?? (process.env.SIIGO_FALLBACK_SELLER_ID ? parseInt(process.env.SIIGO_FALLBACK_SELLER_ID, 10) : undefined);
    } catch (e) {
      return envPrimary ?? (process.env.SIIGO_FALLBACK_SELLER_ID ? parseInt(process.env.SIIGO_FALLBACK_SELLER_ID, 10) : undefined);
    }
  }

  private async listTaxes(authHeaders: SigoAuthHeaders) {
    const key = `${authHeaders['Partner-Id']}::taxes`;
    const now = Date.now();
    const cached = InvoiceService.taxesCache.get(key);
    if (cached && cached.exp > now) return cached.items;
    const res = await this.client.get(`/v1/taxes`, { headers: authHeaders });
    const items: any = (res as any).data?.results || (res as any).data || [];
    const arr = Array.isArray(items) ? items : [];
    InvoiceService.taxesCache.set(key, { items: arr, exp: now + InvoiceService.TTL_MS });
    return arr;
  }

  private async getTaxRateById(authHeaders: SigoAuthHeaders, taxId: number): Promise<number> {
    try {
      const taxes = await this.listTaxes(authHeaders);
      const t = taxes.find((x: any) => Number(x.id) === Number(taxId));
      const raw = t?.percentage ?? t?.rate ?? t?.value;
      const pct = typeof raw === 'number' ? raw : (raw ? parseFloat(String(raw)) : 0);
      if (!isFinite(pct) || pct <= 0) return 0;
      return pct / 100;
    } catch {
      return 0;
    }
  }

  private async isValidTaxId(authHeaders: SigoAuthHeaders, taxId?: number): Promise<boolean> {
    if (!taxId || Number.isNaN(Number(taxId))) return false;
    try {
      const taxes = await this.listTaxes(authHeaders);
      return taxes.some((t: any) => Number(t.id) === Number(taxId));
    } catch {
      return false;
    }
  }

  private buildSellerVariants(base: Record<string, any>, sellerId: number) {
    const clean = (obj: any) => {
      const c = JSON.parse(JSON.stringify(obj));
      delete c.seller; delete c.seller_id; delete c.SalesmanIdentification;
      if (c.document) { delete c.document.seller; delete c.document.seller_id; }
      return c;
    };
    const v: Record<string, any>[] = [];
    { const p = clean(base); p.seller = Number(sellerId); v.push(p); }
    { const p = clean(base); p.seller = { id: Number(sellerId) }; v.push(p); }
    { const p = clean(base); p.seller_id = Number(sellerId); v.push(p); }
    { const p = clean(base); p.document = { ...(base.document || {}), seller: Number(sellerId) }; v.push(p); }
    { const p = clean(base); p.document = { ...(base.document || {}), seller_id: Number(sellerId) }; v.push(p); }
    { const p = clean(base); p.SalesmanIdentification = String(sellerId); v.push(p); }
    return v;
  }

  async createInvoice(
    data: CreateInvoiceData,
    authHeaders: SigoAuthHeaders,
    sellerIdOverride?: number,
    sellerEmailHint?: string,
  ): Promise<Record<string, unknown>> {
    if (data.customerData && data.customerData.numeroDocumento) {
      const existingCustomer = await this.findCustomerByIdentification(
        data.customerData.numeroDocumento,
        authHeaders,
      );

      if (!existingCustomer) {
        try {
          await this.createCustomer(data.customerData, authHeaders);
        } catch (error: unknown) {
          const err = error as { response?: { headers?: Record<string, string> } };
          const code = err?.response?.headers?.['siigoapi-error-code'];
          if (code !== 'already_exists') {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Error creando cliente: ${message}`);
          }
        }
      }
    } else if (data.customer?.identification) {
      try {
        const existing = await this.findCustomerByIdentification(data.customer.identification, authHeaders);
        if (!existing) {
          const inferTipo = (ident: string): CreateClientData['tipoDocumento'] => {
            return 'CC';
          };
          const minimal: CreateClientData = {
            tipoDocumento: inferTipo(data.customer.identification),
            numeroDocumento: data.customer.identification,
            razonSocial: `Cliente ${data.customer.identification}`,
          };
          try {
            await this.createCustomer(minimal, authHeaders);
          } catch (error: unknown) {
            const err = error as { response?: { headers?: Record<string, string> } };
            const code = err?.response?.headers?.['siigoapi-error-code'];
            if (code !== 'already_exists') {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`Error creando cliente: ${message}`);
            }
          }
        }
      } catch (e) {
      }
    }

    let resolvedSellerId = sellerIdOverride ?? (await this.resolveSellerId(authHeaders, sellerEmailHint));
    if (!resolvedSellerId) {
      const envFallback = process.env.SIIGO_SELLER_ID || process.env.SIIGO_FALLBACK_SELLER_ID;
      if (envFallback) resolvedSellerId = parseInt(envFallback, 10);
    }
    if (!resolvedSellerId || Number.isNaN(Number(resolvedSellerId))) {
      const err: any = new Error('No se pudo resolver un seller válido');
      err.code = 'SELLER_UNRESOLVED';
      err.statusCode = 400;
      err.details = { hint: sellerEmailHint };
      throw err;
    }

    const defaultTaxId = process.env.SIIGO_TAX_ID ? parseInt(process.env.SIIGO_TAX_ID, 10) : undefined;
    const defaultTaxIsValid = await this.isValidTaxId(authHeaders, defaultTaxId);

    const preparedItems = await Promise.all((data.items || []).map(async (item) => {
      const base = item.quantity * item.price - (item.discount || 0);
      const taxes = (item.taxes && item.taxes.length > 0)
        ? item.taxes
        : (defaultTaxIsValid && defaultTaxId ? [{ id: defaultTaxId }] : undefined);
      let itemTaxTotal = 0;
      if (taxes && taxes.length) {
        for (const tx of taxes) {
          const rate = await this.getTaxRateById(authHeaders, Number(tx.id));
          if (rate > 0) itemTaxTotal += base * rate;
        }
      }
      return {
        code: item.code,
        description: item.description,
        quantity: item.quantity,
        price: item.price,
        discount: item.discount || 0,
        ...(taxes ? { taxes } : {}),
        __base: base,
        __tax: itemTaxTotal,
      } as any;
    }));

    const subtotal = preparedItems.reduce((t: number, it: any) => t + it.__base, 0);
    const taxesTotal = preparedItems.reduce((t: number, it: any) => t + it.__tax, 0);
    const total = Math.round((subtotal + taxesTotal) * 100) / 100;

    const safePayments: InvoicePayment[] | undefined = Array.isArray(data.payments) && data.payments.length > 0
      ? data.payments.map((p) => ({ id: Number(p.id), value: Number(p.value), due_date: p.due_date }))
      : undefined;

    console.log('[ApiSigo] build payload resumen', {
      items: preparedItems.length,
      subtotal,
      taxesTotal,
      total,
      sellerId: resolvedSellerId,
      hasCustomerData: !!data.customerData,
    });

    const sigoPayload: Record<string, unknown> = {
      document: {
        id: parseInt(process.env.SIIGO_INVOICE_TYPE_ID || '28418', 10),
      },
      date: data.date || new Date().toISOString().split('T')[0],
      seller: Number(resolvedSellerId),
      customer: {
        identification: data.customer.identification,
        branch_office: data.customer.branch_office || 0,
      },
      observations: data.observations,
      items: preparedItems.map(({ __base, __tax, ...it }: any) => it),
      payments:
        (safePayments && safePayments.length > 0)
          ? safePayments
          : (data.payments && (Array.isArray(data.payments) && data.payments.length > 0)
            ? data.payments
            : undefined),
    };

    try {
      const invoiceTimeout = parseInt(process.env.SIIGO_INVOICE_TIMEOUT_MS || process.env.SIGO_TIMEOUT || '60000', 10);
      const headers = { ...authHeaders } as Record<string, string>;
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
      if (headers['Partner-Id'] && !headers['Partner-ID']) headers['Partner-ID'] = headers['Partner-Id'];

      const variants = this.buildSellerVariants(sigoPayload, Number(resolvedSellerId));
      console.log('[ApiSigo] intentos variantes seller', { variants: variants.length });

      let lastErr: any;
      for (let i = 0; i < variants.length; i++) {
        const payloadToSend: any = JSON.parse(JSON.stringify(variants[i]));
        console.log('[ApiSigo] intento envío', { variant: i + 1, hasDocSeller: !!payloadToSend?.document?.seller, hasRootSeller: Object.prototype.hasOwnProperty.call(payloadToSend, 'seller') });
        try {
          const response = await this.client.post('/v1/invoices', payloadToSend, { headers, timeout: invoiceTimeout });
          const out = (response as { data: Record<string, unknown> }).data;
          // Olympo: ApiSigo owns the `invoice` SSOT → emit INVOICE_SENT (non-blocking,
          // fault-tolerant; never gates the local invoicing flow). See src/cauce/hub.ts.
          this.emitInvoiceSent(out, data);
          return out;
        } catch (err: any) {
          const siigoCode = err?.response?.headers?.['siigoapi-error-code'];
          const msg = err?.response?.data?.Errors?.[0]?.Message || err?.message || '';
          const params = err?.response?.data?.Errors?.[0]?.Params || [];
          const isSellerReq = siigoCode === 'parameter_required' && (msg?.toLowerCase().includes('seller') || params?.includes('seller'));
          const isInvalidTax = siigoCode === 'invalid_reference' && (msg?.toLowerCase().includes('tax') || params?.some((p: string) => p.includes('taxes')));
          console.error('[ApiSigo] fallo variante', { variant: i + 1, siigoCode, msg });

          if (isInvalidTax) {
            const withoutTaxes = JSON.parse(JSON.stringify(payloadToSend));
            if (Array.isArray(withoutTaxes.items)) {
              withoutTaxes.items = withoutTaxes.items.map((it: any) => { const { taxes, ...rest } = it || {}; return rest; });
            }
            try {
              console.log('[ApiSigo] reintento sin taxes');
              const response2 = await this.client.post('/v1/invoices', withoutTaxes, { headers, timeout: invoiceTimeout });
              const out2 = (response2 as { data: Record<string, unknown> }).data;
              // Olympo: emit INVOICE_SENT on the no-taxes retry success path too.
              this.emitInvoiceSent(out2, data);
              return out2;
            } catch (err2: any) {
              lastErr = err2;
              break;
            }
          }
          if (!isSellerReq || i === variants.length - 1) { lastErr = err; break; }
          lastErr = err;
        }
      }
      throw lastErr;
    } catch (error: any) {
      const status = error?.response?.status;
      const details = error?.response?.data;
      const siigoCode = error?.response?.headers?.['siigoapi-error-code'];
      const e = new Error(error?.message || 'SIGO API error') as any;
      e.code = 'SIGO_API_ERROR';
      e.statusCode = status || 502;
      let sentBody: any;
      try { sentBody = typeof error?.config?.data === 'string' ? error.config.data : JSON.stringify(error?.config?.data); } catch { }
      const shape = (() => {
        try {
          const s: any = (typeof sentBody === 'string' ? JSON.parse(sentBody) : sentBody) || {};
          return {
            hasRootSeller: Object.prototype.hasOwnProperty.call(s, 'seller'),
            rootSeller: s?.seller && typeof s?.seller,
            hasRootSellerId: Object.prototype.hasOwnProperty.call(s, 'seller_id'),
            rootSellerId: s?.seller_id && typeof s?.seller_id,
            hasDoc: !!s?.document,
            hasDocSeller: s?.document && Object.prototype.hasOwnProperty.call(s.document, 'seller'),
            docSeller: s?.document?.seller && typeof s?.document?.seller,
            hasDocSellerId: s?.document && Object.prototype.hasOwnProperty.call(s.document, 'seller_id'),
            docSellerId: s?.document?.seller_id && typeof s?.document?.seller_id,
          };
        } catch { return null; }
      })();
      e.details = {
        siigoCode,
        details,
        code: error?.code,
        errno: error?.errno,
        url: error?.config?.url,
        method: error?.config?.method,
        timeout: error?.config?.timeout,
        payloadShape: shape,
      };
      console.error('[ApiSigo] error final createInvoice', { status: e.statusCode, siigoCode, shape });
      throw e;
    }
  }

  /**
   * Olympo integration: announce a successful SIGO invoice to HubCentral.
   *
   * Best-effort and non-blocking — the HubClient swallows transport errors, and
   * we additionally guard locally so a publish failure can never affect the
   * caller's return value. `orderId` is derived from the observations note
   * ("...desde orden #<id>") when the invoice came from a Graf/POS order.
   */
  private emitInvoiceSent(sigoResult: Record<string, unknown>, data: CreateInvoiceData): void {
    try {
      const invoiceId = String(
        (sigoResult as any)?.id ??
          (sigoResult as any)?.number ??
          (sigoResult as any)?.name ??
          '',
      );
      if (!invoiceId) return;

      const obsMatch = /orden\s*#\s*(\w+)/i.exec(data.observations || '');
      const orderId = obsMatch?.[1] ?? invoiceId;
      const pdfUrl =
        (sigoResult as any)?.public_url ?? (sigoResult as any)?.pdf_url ?? undefined;

      // Fire-and-forget: do not await (keeps the invoicing response latency intact).
      void publishInvoiceSent({ invoiceId, orderId, pdfUrl });
    } catch {
      // never let observability/integration affect the business result
    }
  }

  async getPaymentTypes(
    authHeaders: SigoAuthHeaders,
    documentType: string = 'FV',
  ): Promise<Record<string, unknown>> {
    const response = await this.client.get(`/v1/payment-types?document_type=${documentType}`, {
      headers: authHeaders,
    });
    return (response as { data: Record<string, unknown> }).data;
  }

  async createCreditNoteByInvoiceNumber(
    serie: string,
    numero: string | number,
    authHeaders: SigoAuthHeaders,
    motivo?: string,
  ): Promise<Record<string, unknown>> {
    const res = await this.client.get(`/v1/invoices?number=${encodeURIComponent(String(numero))}`, { headers: authHeaders });
    const list: any[] = (res as any).data?.results || [];
    const inv = Array.isArray(list) && list.length > 0 ? list[0] : null;
    if (!inv || !inv.id) {
      throw new Error('Factura no encontrada en Siigo');
    }

    const payload: Record<string, unknown> = {
      document: { id: parseInt(process.env.SIIGO_CREDIT_NOTE_DOCUMENT_ID || '28420', 10) },
      date: new Date().toISOString().split('T')[0],
      customer: {
        identification: inv?.customer?.identification || '',
        branch_office: 0,
      },
      invoice: { id: inv.id },
      observations: motivo || 'Anulación total',
    };

    const cn = await this.client.post('/v1/credit-notes', payload, { headers: authHeaders });
    return (cn as { data: Record<string, unknown> }).data;
  }

  convertOrderToInvoice(order: {
    id: number;
    store?: { name?: string };
    customer?: { documentNumber?: string; name?: string; email?: string; phone?: string };
    user?: { documentNumber?: string; name?: string; email?: string };
    items: Array<{ product: { id: number; title: string; code?: string }; quantity: number; finalPrice: number }>;
  }): CreateInvoiceData {
    const idDoc = order.customer?.documentNumber || order.user?.documentNumber || '222222222222';

    const customerData = idDoc !== '222222222222'
      ? {
        tipoDocumento: 'CC' as const,
        numeroDocumento: idDoc,
        razonSocial: order.customer?.name || order.user?.name || 'Cliente Sin Nombre',
        email: order.customer?.email || order.user?.email,
        telefono: order.customer?.phone,
      }
      : undefined;

    return {
      date: new Date().toISOString().split('T')[0],
      customer: { identification: idDoc, branch_office: 0 },
      customerData,
      items: order.items.map((it) => ({
        code: it.product.code || `GRAF-${it.product.id}`,
        description: it.product.title,
        quantity: it.quantity,
        price: it.finalPrice,
        discount: 0,
      })),
      observations: `Factura generada desde orden #${order.id}${order.store?.name ? ' - Tienda: ' + order.store.name : ''}`,
    };
  }
}