import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

interface ApiErrorLike extends Error {
  statusCode?: number;
  status?: number;
  code?: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const err = exception as ApiErrorLike;


    if ((err as any)?.code === 'SIGO_API_ERROR') {
      const status = (err as any)?.statusCode || HttpStatus.BAD_GATEWAY;
      return response.status(status).json({
        success: false,
        error: 'Error del servicio SIGO',
        message: err?.message || 'Hubo un problema comunicándose con SIGO',
        details: (err as any).details,
      });
    }

    if ((err as any)?.name === 'ValidationError') {
      return response.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Error de validación',
        details: (err as any).details || err.message,
      });
    }

    const statusCode =
      (err?.statusCode as number) || (err?.status as number) ||
      (exception instanceof HttpException ? exception.getStatus() : undefined);

    if ((err as any)?.name === 'UnauthorizedError' || statusCode === 401) {
      return response.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: 'No autorizado',
        message: 'Credenciales inválidas o token expirado',
      });
    }

    if (statusCode === 403) {
      return response.status(HttpStatus.FORBIDDEN).json({
        success: false,
        error: 'Acceso prohibido',
        message: 'No tienes permisos para realizar esta acción',
      });
    }

    if (statusCode === 404) {
      return response.status(HttpStatus.NOT_FOUND).json({
        success: false,
        error: 'Recurso no encontrado',
        message: err?.message || 'El recurso solicitado no existe',
      });
    }

    if (statusCode === 409) {
      return response.status(HttpStatus.CONFLICT).json({
        success: false,
        error: 'Conflicto',
        message: err?.message || 'El recurso ya existe o hay un conflicto',
      });
    }

    if (statusCode === 429) {
      return response.status(HttpStatus.TOO_MANY_REQUESTS).json({
        success: false,
        error: 'Demasiadas solicitudes',
        message: 'Has excedido el límite de solicitudes. Intenta más tarde.',
      });
    }

    const msg = (err?.message || '').toLowerCase();
    if ((err as any)?.code === 'ECONNABORTED' || msg.includes('timeout')) {
      return response.status(HttpStatus.GATEWAY_TIMEOUT).json({
        success: false,
        error: 'Timeout',
        message: 'La operación tardó demasiado tiempo en completarse',
      });
    }

    if ((err as any)?.code === 'ECONNREFUSED' || (err as any)?.code === 'ENOTFOUND') {
      return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Servicio no disponible',
        message: 'No se pudo conectar con el servicio externo',
      });
    }

    if (exception instanceof SyntaxError && (exception as any).type === 'entity.parse.failed') {
      return response.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: 'JSON inválido',
        message: 'El cuerpo de la solicitud contiene JSON malformado',
      });
    }

    const isProd = process.env.NODE_ENV === 'production';
    const fallbackStatus = statusCode || HttpStatus.INTERNAL_SERVER_ERROR;

    return response.status(fallbackStatus).json({
      success: false,
      error: 'Error interno del servidor',
      message: isProd ? 'Ocurrió un error inesperado' : err?.message,
      ...(isProd ? {} : { stack: err?.stack }),
    });
  }
}
