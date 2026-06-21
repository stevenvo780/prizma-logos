import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import SigoAuthService from "@/services/sigoAuthService";
import { verifySignature } from "prizma-contracts";

export interface SigoCredentials {
  email: string;
  apiKey: string;
}

export interface RequestWithSigoCredentials extends Request {
  sigoCredentials?: SigoCredentials;
  sigoAuthHeaders?: {
    Authorization: string;
    "Partner-Id": string;
  };
}

@Injectable()
export class SigoCredentialsMiddleware implements NestMiddleware {
  async use(
    req: RequestWithSigoCredentials,
    res: Response,
    next: NextFunction,
  ) {
    try {
      // For Nous event sink (/invoices/from-event), require valid HMAC signature
      if (this.isNousEventSink(req)) {
        const signature = req.headers["x-hub-signature"] as string | undefined;
        const secret = process.env.HUB_WEBHOOK_SECRET;

        if (!secret) {
          res.status(401).json({
            error: "Webhook not configured",
            message: "HUB_WEBHOOK_SECRET not set in environment (required for from-event)",
          });
          return;
        }

        // Collect raw body for HMAC verification
        const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});
        if (!verifySignature(rawBody, signature, secret)) {
          res.status(401).json({
            error: "Invalid webhook signature",
            message: "x-hub-signature verification failed",
          });
          return;
        }

        // Signature verified, proceed without SIGO credentials
        next();
        return;
      }

      const email = req.headers["x-email"] as string;
      const apiKey = req.headers["x-api-key"] as string;

      if (!email || !apiKey) {
        res.status(401).json({
          error: "Credenciales SIGO requeridas",
          message: "Debe proporcionar x-email y x-api-key en los headers",
          headers_required: {
            "x-email": "Email de usuario SIGO",
            "x-api-key": "API Key de SIGO",
          },
        });
        return;
      }

      const signature = req.headers["x-hub-signature"] as string | undefined;
      if (signature) {
        const secret = process.env.HUB_WEBHOOK_SECRET;
        if (secret) {
          const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});
          if (!verifySignature(rawBody, signature, secret)) {
            res.status(401).json({ error: "Firma de webhook inválida" });
            return;
          }
        }
      }

      req.sigoCredentials = { email: email.trim(), apiKey: apiKey.trim() };
      const authHeaders = await SigoAuthService.getAuthHeaders(
        req.sigoCredentials,
      );
      req.sigoAuthHeaders = authHeaders;
      next();
    } catch (error) {
      res.status(401).json({
        error: "Error de autenticación SIGO",
        message: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  private isNousEventSink(req: Request): boolean {
    // Usar originalUrl: con setGlobalPrefix('api') + forRoutes('*'), NestJS monta
    // el middleware en un sub-path y req.path/req.url pueden no incluir el prefijo.
    // originalUrl siempre es la URL completa original, inmune al montaje.
    const url = req.originalUrl || req.url || req.path || "";
    return req.method === "POST" && url.includes("/invoices/from-event");
  }
}
