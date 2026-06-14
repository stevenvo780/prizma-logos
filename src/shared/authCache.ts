interface AuthCache {
  token: string;
  email: string;
  apiKey: string;
  expiresAt: number;
  tokenExpiresAt?: number; // Real expiration from JWT
}

let authCache: AuthCache | null = null;

export class AuthenticationCache {
  // Reducido a 15 minutos por seguridad (los tokens SIGO suelen expirar a los 20-30 min)
  private static readonly CACHE_DURATION = 15 * 60 * 1000;
  // Margen de seguridad: renovar 2 minutos antes de expiración real
  private static readonly SAFETY_MARGIN = 2 * 60 * 1000;

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
    if (!authCache) return null;

    if (authCache.email !== email || authCache.apiKey !== apiKey) {
      this.clearCache();
      return null;
    }

    const now = Date.now();
    
    // Verificar expiración de cache
    if (now > authCache.expiresAt) {
      console.log(
        `[AuthCache] Token expirado por TTL cache (${email}). ` +
        `Expiró: ${new Date(authCache.expiresAt).toISOString()}`
      );
      this.clearCache();
      return null;
    }

    // Verificar expiración real del JWT (si está disponible)
    if (authCache.tokenExpiresAt) {
      // Aplicar margen de seguridad
      const effectiveExpiration = authCache.tokenExpiresAt - this.SAFETY_MARGIN;
      
      if (now > effectiveExpiration) {
        console.log(
          `[AuthCache] Token JWT expirará pronto o ya expiró (${email}). ` +
          `Expira: ${new Date(authCache.tokenExpiresAt).toISOString()}, ` +
          `Margen: ${this.SAFETY_MARGIN / 1000}s`
        );
        this.clearCache();
        return null;
      }
    }

    return authCache.token;
  }

  static setToken(email: string, apiKey: string, token: string): void {
    const tokenExpiresAt = this.extractTokenExpiration(token);
    const cacheExpiresAt = Date.now() + this.CACHE_DURATION;
    
    // Usar el menor entre la expiración del cache y la del token
    const expiresAt = tokenExpiresAt 
      ? Math.min(cacheExpiresAt, tokenExpiresAt - this.SAFETY_MARGIN)
      : cacheExpiresAt;

    authCache = {
      token,
      email,
      apiKey,
      expiresAt,
      tokenExpiresAt: tokenExpiresAt ?? undefined,
    };

    console.log(
      `[AuthCache] Token almacenado (${email}). ` +
      `Cache expira: ${new Date(expiresAt).toISOString()}` +
      (tokenExpiresAt ? `, JWT expira: ${new Date(tokenExpiresAt).toISOString()}` : "")
    );
  }

  static clearCache(): void {
    if (authCache) {
      console.log(`[AuthCache] Cache limpiado para ${authCache.email}`);
    }
    authCache = null;
  }
}

export default AuthenticationCache;
