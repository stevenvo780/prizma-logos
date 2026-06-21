/**
 * Prizma integration for Logos (electronic invoicing — SIGO/Siigo).
 *
 * Logos is the owner (SSOT) of the `invoice` data domain, so the events it is
 * authorised to *emit* into the Prizma ecosystem are the INVOICE_* events
 * (see ARCHITECTURE.md §4-5, matriz SSOT: "Facturas → dueño Logos (SIGO),
 * consumen Graf, Sinergia"). Concretely:
 *   - INVOICE_CREATE (`invoice.create`) — an invoice request was built/started.
 *   - INVOICE_SENT   (`invoice.sent`)   — an invoice was successfully emitted in SIGO.
 *
 * The HubClient is fault-tolerant by design: a failed publish never throws into
 * business logic (connectors are optional, ARCHITECTURE.md §2.2). Call sites can
 * therefore `await publishInvoiceSent(...)` without try/catch and without risking
 * the local invoicing flow.
 */
import { HubClient, EVENTS, validateEvent, type EventEnvelope } from 'prizma-contracts';

/** Build opts conditionally so we never pass explicit `undefined` to optional fields. */
const hubOpts: { source: 'logos'; hubUrl?: string; secret?: string } = { source: 'logos' };
const hubUrl = process.env.NOUS_HUB_URL;
if (hubUrl) hubOpts.hubUrl = hubUrl;
// Reuse the inbound webhook secret if a dedicated hub secret is not provided.
const hubSecret = process.env.NOUS_HUB_SECRET ?? process.env.HUB_WEBHOOK_SECRET;
if (hubSecret) hubOpts.secret = hubSecret;

/** Shared singleton client, tagged as the `logos` source. */
export const hub = new HubClient(hubOpts);

/** Minimal customer reference matching `prizma-contracts` CustomerRefSchema. */
export interface PrizmaCustomerRef {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
}

/** Minimal order line item matching `prizma-contracts` OrderItemSchema. */
export interface PrizmaOrderItem {
  sku: string;
  name?: string;
  qty: number;
  unitPrice: number;
}

/** Drop empty/undefined keys so the customer payload validates cleanly. */
function cleanCustomer(customer: PrizmaCustomerRef): PrizmaCustomerRef {
  const cleaned: PrizmaCustomerRef = {};
  if (customer.id) cleaned.id = customer.id;
  if (customer.name) cleaned.name = customer.name;
  if (customer.phone) cleaned.phone = customer.phone;
  if (customer.email) cleaned.email = customer.email;
  return cleaned;
}

/**
 * Publish an INVOICE_CREATE (`invoice.create`) event: an invoice has been
 * requested/built for an order. Owned by Logos, consumed by Graf/Sinergia.
 *
 * Non-blocking / fault-tolerant: resolves to `false` on any transport error
 * instead of throwing. Do NOT wrap in try/catch nor let it gate the invoice write.
 */
export async function publishInvoiceCreate(input: {
  orderId: string;
  customer: PrizmaCustomerRef;
  items: PrizmaOrderItem[];
  total: number;
}): Promise<boolean> {
  return hub.publish(EVENTS.INVOICE_CREATE, {
    orderId: input.orderId,
    customer: cleanCustomer(input.customer),
    items: input.items,
    total: input.total,
  });
}

/**
 * Publish an INVOICE_SENT (`invoice.sent`) event: an invoice was successfully
 * emitted in SIGO. This is the canonical "fact of business" for Logos.
 * Owned by Logos, consumed by Graf/Sinergia.
 *
 * Non-blocking / fault-tolerant: resolves to `false` on any transport error
 * instead of throwing. Do NOT wrap in try/catch nor let it gate the invoice write.
 */
export async function publishInvoiceSent(input: {
  invoiceId: string;
  orderId: string;
  pdfUrl?: string;
}): Promise<boolean> {
  const data: { invoiceId: string; orderId: string; pdfUrl?: string } = {
    invoiceId: input.invoiceId,
    orderId: input.orderId,
  };
  if (input.pdfUrl) data.pdfUrl = input.pdfUrl;
  return hub.publish(EVENTS.INVOICE_SENT, data);
}

/** Re-exports so call sites only need to import from this module. */
export { HubClient, EVENTS, validateEvent };
export type { EventEnvelope };
