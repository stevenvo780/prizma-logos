import axios from 'axios';

const BASE = process.env.BASE || 'http://localhost:4001';
const API_EMAIL = process.env.API_EMAIL || 'hola.salinero@salinero.co';
const API_KEY = process.env.API_KEY || 'MWY0MTRkZjgtNWIzMi00ZmRhLWJkYmUtNmI2Y2VhYmM1OTI3Om4xfi1OWmc9NEc=';

const headers = {
  'x-email': API_EMAIL,
  'x-api-key': API_KEY,
};

async function main() {
  const results: any[] = [];
  const get = async (url: string, h: any = {}) => {
    try {
      const res = await axios.get(`${BASE}${url}`, { headers: { ...headers, ...h }, timeout: 8000 });
      return { ok: true, status: res.status, data: res.data };
    } catch (e: any) {
      return { ok: false, status: e.response?.status, error: e.message, data: e.response?.data };
    }
  };
  const post = async (url: string, body: any, h: any = {}) => {
    try {
      const res = await axios.post(`${BASE}${url}`, body, { headers: { 'Content-Type': 'application/json', ...headers, ...h }, timeout: 12000 });
      return { ok: true, status: res.status, data: res.data };
    } catch (e: any) {
      return { ok: false, status: e.response?.status, error: e.message, data: e.response?.data };
    }
  };

  results.push(['GET /api', await get('/api', {})]);
  results.push(['GET /api/docs', await get('/api/docs', {})]);
  results.push(['GET /api/invoices/__health', await get('/api/invoices/__health')]);
  results.push(['GET /api/invoices/payment-types', await get('/api/invoices/payment-types?document_type=FV')]);

  const today = new Date().toISOString().slice(0, 10);
  const createBody = {
    date: today,
    customer: { identification: '222222222222', branch_office: 0 },
    items: [ { code: 'QFI-P09-P03', description: 'Producto demo', quantity: 1, price: 12345 } ],
    observations: 'Smoke test desde script',
  };
  results.push(['POST /api/invoices', await post('/api/invoices', createBody)]);

  for (const [name, r] of results) {
    if (r.ok) {
    } else {
    }
  }
}

main().catch(() => { process.exit(1); });
