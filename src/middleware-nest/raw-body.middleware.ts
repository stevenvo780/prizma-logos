import { IncomingMessage } from 'http';
import { ServerResponse } from 'http';

/**
 * Captura el raw body de una request JSON ANTES de que Express lo parsee.
 *
 * Uso: aplicar este middleware en main.ts:
 *   app.use(express.json({ verify: captureRawBody }));
 *
 * La opción 'verify' de express.json() es invocada DESPUÉS de que el buffer se lee
 * pero ANTES de que se parsee a JSON, lo que permite capturar el raw body y luego
 * dejar que Express continue con el parseo normal.
 *
 * @param req - IncomingMessage (Express Request)
 * @param res - ServerResponse (Express Response)
 * @param buf - Buffer crudo que Express va a parsear
 * @param encoding - Encoding del buffer (como string)
 */
export function captureRawBody(
  req: IncomingMessage,
  res: ServerResponse,
  buf: Buffer,
  encoding: string,
): void {
  // Guardar el buffer raw en req para acceso posterior en middleware de verificación de firma
  (req as any).rawBody = buf.toString(encoding as BufferEncoding);
}
