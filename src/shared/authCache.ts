import { createHash } from "crypto";

interface AuthCache {
  token: string;
  email: string;
  apiKey: string;
  expiresAt: number;
  tokenExpiresAt?: number; // Real expiration from JWT
}

// Multi-tenant cache: keyed by hash(email+apiKey) instead of single global slot
const authCacheMap = new Map<string, AuthCache>();

export class AuthenticationCache {
  // Reducido a 15 minutos por seguridad (los tokens SIGO suelen expirar a los 20-30 min)
  private static readonly CACHE_DURATION = 15 * 60 * 1000;
  // Margen de seguridad: renovar 2 minutos antes de expiración real
  private static readonly SAFETY_MARGIN = 2 * 60 * 1000;

  // Enmascara el email para logs (PII): conserva 2 chars del local-part + dominio.
  private static maskEmail(email: string): string {
    const e = (email || "").trim();
    if (!e) return "<empty>";
    const at = e.indexOf("@");
    if (at <= 0) return "***";
    return `${e.slice(0, 2)}***${e.slice(at)}`;
  }

  /**
   * Genera clave de cache determinista para un par email+apiKey
   */
  private static getCacheKey(email: string, apiKey: string): string {
    return createHash("sha256")
      .update(`${email}:${apiKey}`)
      .digest("hex");
  }

  /**
   * Extrae la expiración real del token JWT
   */
  private static extractTokenExpiration(token: string): number | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      );

      // 'exp' viene en segundos desde epoch
      if (payload.exp && typeof payload.exp === "number") {
        return payload.exp * 1000; // Convertir a milisegundos
      }

      return null;
    } catch (error) {
      console.error("[AuthCache] Error extrayendo expiración del token:", error);
      return null;
    }
  }

  static getToken(email: string, apiKey: string): string | null {
    const key = this.getCacheKey(email, apiKey);
    const authCache = authCacheMap.get(key);

    if (!authCache) return null;

    const now = Date.now();

    // Verificar expiración de cache
    if (now > authCache.expiresAt) {
      console.log(
        `[AuthCache] Token expirado por TTL cache (${this.maskEmail(email)}). ` +
        `Expiró: ${new Date(authCache.expiresAt).toISOString()}`
      );
      authCacheMap.delete(key);
      return null;
    }

    // Verificar expiración real del JWT (si está disponible)
    if (authCache.tokenExpiresAt) {
      // Aplicar margen de seguridad
      const effectiveExpiration = authCache.tokenExpiresAt - this.SAFETY_MARGIN;

      if (now > effectiveExpiration) {
        console.log(
          `[AuthCache] Token JWT expirará pronto o ya expiró (${this.maskEmail(email)}). ` +
          `Expira: ${new Date(authCache.tokenExpiresAt).toISOString()}, ` +
          `Margen: ${this.SAFETY_MARGIN / 1000}s`
        );
        authCacheMap.delete(key);
        return null;
      }
    }

    return authCache.token;
  }

  static setToken(email: string, apiKey: string, token: string): void {
    const key = this.getCacheKey(email, apiKey);
    const tokenExpiresAt = this.extractTokenExpiration(token);
    const cacheExpiresAt = Date.now() + this.CACHE_DURATION;

    // Usar el menor entre la expiración del cache y la del token
    const expiresAt = tokenExpiresAt
      ? Math.min(cacheExpiresAt, tokenExpiresAt - this.SAFETY_MARGIN)
      : cacheExpiresAt;

    authCacheMap.set(key, {
      token,
      email,
      apiKey,
      expiresAt,
      tokenExpiresAt: tokenExpiresAt ?? undefined,
    });

    console.log(
      `[AuthCache] Token almacenado (${this.maskEmail(email)}). ` +
      `Cache expira: ${new Date(expiresAt).toISOString()}` +
      (tokenExpiresAt ? `, JWT expira: ${new Date(tokenExpiresAt).toISOString()}` : "")
    );
  }

  /**
   * Limpiar cache solo para la clave específica (no global)
   */
  static clearCache(email: string, apiKey: string): void {
    const key = this.getCacheKey(email, apiKey);
    if (authCacheMap.has(key)) {
      console.log(`[AuthCache] Cache limpiado para ${this.maskEmail(email)}`);
      authCacheMap.delete(key);
    }
  }

  /**
   * Limpiar todo el cache (solo para reset completo en tests)
   */
  static clearAllCache(): void {
    console.log(`[AuthCache] Cache global limpiado (${authCacheMap.size} entradas removidas)`);
    authCacheMap.clear();
  }
}

export default AuthenticationCache;
