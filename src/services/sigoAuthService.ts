import axios from "axios";
import AuthenticationCache from "@/shared/authCache";
import type { SigoCredentials } from "@/middleware-nest/sigo-credentials.middleware";

interface SigoAuthResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface SigoAuthHeaders {
  Authorization: string;
  "Partner-Id": string;
}

export class SigoAuthService {
  private static normalizeAccessKey(input: string): string {
    const t = (input || "").trim();
    if (!t) return t;

    if (t.includes(":")) {
      try {
        return Buffer.from(t, "utf8").toString("base64");
      } catch {
        return t;
      }
    }

    try {
      const decoded = Buffer.from(t, "base64").toString("utf8");
      if (decoded.includes(":")) {
        return t;
      }
    } catch {}

    return t;
  }

  public static extractPartnerIdFromToken(token: string): string | null {
    try {
      const part = token.split(".")[1];
      if (!part) return null;
      const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "===".slice((base64.length + 3) % 4);
      const json = Buffer.from(padded, "base64").toString("utf8");
      const payload = JSON.parse(json);
      return payload.api_subscription_key || null;
    } catch (error) {
      return null;
    }
  }

  private static extractPartnerIdFromApiKey(apiKey: string): string | null {
    const t = (apiKey || "").trim();
    if (!t) return null;
    const trySplit = (s: string) => {
      const idx = s.indexOf(":");
      return idx > 0 ? s.slice(0, idx) : null;
    };
    const plain = trySplit(t);
    if (plain) return plain;
    try {
      const decoded = Buffer.from(t, "base64").toString("utf8");
      const fromDecoded = trySplit(decoded);
      if (fromDecoded) return fromDecoded;
    } catch {}
    return null;
  }

  public static async authenticate(
    credentials: SigoCredentials,
  ): Promise<string> {
    try {
      const authUrl = `${process.env.SIGO_API_URL || "https://api.siigo.com"}/auth/user-login`;
      const accessKey = this.normalizeAccessKey(credentials.apiKey);
      const authData = {
        username: credentials.email,
        access_key: accessKey,
      };

      console.log(
        `[SigoAuth] Autenticando usuario: ${credentials.email} en ${authUrl}`
      );

      const response = await axios.post<SigoAuthResponse>(authUrl, authData, {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.data?.access_token) {
        throw new Error("No se recibió token de autenticación");
      }

      const token = response.data.access_token;

      console.log(
        `[SigoAuth] ✓ Autenticación exitosa para ${credentials.email}` +
        (response.data.expires_in ? ` (expira en ${response.data.expires_in}s)` : "")
      );

      AuthenticationCache.setToken(
        credentials.email,
        credentials.apiKey,
        token,
      );

      return token;
    } catch (error) {
      console.error(
        `[SigoAuth] ✗ Error de autenticación para ${credentials.email}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(`Error de autenticación: ${error}`);
    }
  }

  public static async getAuthHeaders(
    credentials: SigoCredentials,
    forceRefresh = false,
  ): Promise<SigoAuthHeaders> {
    // Si se fuerza refresh, limpiar cache primero
    if (forceRefresh) {
      console.log(`[SigoAuth] Refresh forzado para ${credentials.email}`);
      AuthenticationCache.clearCache();
    }

    let token = AuthenticationCache.getToken(
      credentials.email,
      credentials.apiKey,
    );

    if (!token) {
      token = await this.authenticate(credentials);
    }

    let partnerId = process.env.SIIGO_PARTNER_ID || null;
    if (!partnerId) {
      partnerId = this.extractPartnerIdFromToken(token);
    }
    if (!partnerId) {
      partnerId = this.extractPartnerIdFromApiKey(credentials.apiKey);
    }
    if (!partnerId) {
      throw new Error("No se pudo resolver Partner-Id");
    }

    return {
      Authorization: `Bearer ${token}`,
      "Partner-Id": partnerId,
    };
  }
}

export default SigoAuthService;
