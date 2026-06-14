import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";
import SigoAuthService from "@/services/sigoAuthService";
import type { RequestWithSigoCredentials } from "./sigo-credentials.middleware";

/**
 * Interceptor que reintenta automáticamente cuando recibe error 401
 * Limpia el cache de autenticación y obtiene un nuevo token
 */
@Injectable()
export class RetryOnAuthErrorInterceptor implements NestInterceptor {
  private readonly MAX_RETRIES = 1;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithSigoCredentials>();
    const originalAuthHeaders = request.sigoAuthHeaders;
    const credentials = request.sigoCredentials;

    return next.handle().pipe(
      catchError((error) => {
        // Solo reintentar en errores 401 y si tenemos credenciales
        const is401 = error?.response?.status === 401 || error?.status === 401;
        const hasCredentials = credentials?.email && credentials?.apiKey;
        const notYetRetried = !(request as any)._authRetried;

        if (is401 && hasCredentials && notYetRetried) {
          console.warn(
            `[RetryInterceptor] ⚠️ Error 401 detectado. ` +
            `Reintentando con nuevo token para ${credentials.email}...`
          );

          // Marcar que ya se intentó retry
          (request as any)._authRetried = true;

          // Obtener nuevos headers con refresh forzado
          return new Observable((observer) => {
            SigoAuthService.getAuthHeaders(credentials, true)
              .then((newAuthHeaders) => {
                // Actualizar headers en el request
                request.sigoAuthHeaders = newAuthHeaders;
                
                console.log(
                  `[RetryInterceptor] ✓ Nuevo token obtenido. Reintentando request...`
                );

                // Reintentar la operación con nuevos headers
                next.handle().subscribe({
                  next: (value) => observer.next(value),
                  error: (err) => {
                    console.error(
                      `[RetryInterceptor] ✗ Retry falló:`,
                      err?.message || String(err)
                    );
                    observer.error(err);
                  },
                  complete: () => observer.complete(),
                });
              })
              .catch((authError) => {
                console.error(
                  `[RetryInterceptor] ✗ Error obteniendo nuevo token:`,
                  authError?.message || String(authError)
                );
                
                // Si falla la re-autenticación, devolver error 401
                observer.error(
                  new HttpException(
                    {
                      error: "Error de autenticación SIGO",
                      message: "No se pudo renovar el token de autenticación",
                      details: authError?.message || String(authError),
                    },
                    HttpStatus.UNAUTHORIZED
                  )
                );
              });
          });
        }

        // Si no es 401, ya se reintentó, o no hay credenciales, devolver error original
        return throwError(() => error);
      })
    );
  }
}
