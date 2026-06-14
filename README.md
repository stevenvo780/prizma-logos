# ApiSigo

Servicio de facturación e integración SIGO (Colombia) usado por Hub Central.

## Características

- Gestión de clientes (crear)
- Facturación: crear y anulación (nota de crédito)
- Validación, CORS y manejo de errores

## Instalación y uso

```bash
cd ApiSigo
npm install
cp .env.example .env   # configura credenciales SIGO

# Desarrollo
npm run dev

# Producción
npm run build && npm start
```

Puerto por defecto: `3004` (configurable vía `PORT`).

## Configuración (.env)

Variables principales (ver `.env.example`):
- `SIGO_API_URL`, `SIGO_API_KEY`, `SIGO_USERNAME`, `SIGO_PASSWORD`
- `ALLOWED_ORIGINS` para CORS (opcional)
- Requiere SKU real en cada ítem; no se generan códigos sintéticos

## Endpoints

Base: `http://localhost:3004`

### Clientes
- `POST /api/clients` → Crear cliente

### Facturas
- `POST /api/invoices` → Crear factura
- `POST /api/invoices/:serie/:numero/cancel` → Anular (crea nota de crédito)

Headers requeridos para `/api/invoices` y rutas protegidas:
- `x-email`: correo del usuario SIGO
- `x-api-key`: API Key de SIGO

Firma opcional de webhook:
- `x-hub-signature` (opcional): si presente, debe coincidir con `HUB_WEBHOOK_SECRET` en este servicio.
- Si no se envía, la petición será aceptada siempre que `x-email` y `x-api-key` sean válidos.

## Respuestas tipo

Éxito
```json
{ "success": true, "message": "OK", "data": { } }
```

Error
```json
{ "error": "BadRequest", "message": "Descripción", "details": { } }
```

## Health

- `GET /api` → metadatos y rutas disponibles
- `GET /api/docs` → documentación JSON rápida
