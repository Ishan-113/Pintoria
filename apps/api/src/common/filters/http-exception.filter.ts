import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE',
  413: 'FILE_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as unknown;
      if (typeof resp === 'string') {
        body = { code: CODE_BY_STATUS[status] ?? 'ERROR', message: resp };
      } else if (resp && typeof resp === 'object') {
        const r = resp as Record<string, unknown>;
        const rawMessage = r.message;
        let message: string =
          typeof rawMessage === 'string'
            ? rawMessage
            : `${exception.message.split(' ').slice(0, 4).join(' ')}`;
        let details: unknown = undefined;

        if (Array.isArray(rawMessage)) {
          message = 'Please fix the highlighted fields.';
          details = { fields: rawMessage };
        } else if (r.details || r.allowedActions) {
          details = r.details ?? { allowedActions: r.allowedActions };
        }
        body = { code: (r.code as string) ?? CODE_BY_STATUS[status] ?? 'ERROR', message, details };
      }
    } else if (exception instanceof Error) {
      body.message =
        process.env.NODE_ENV === 'local' ? exception.message : 'Something went wrong. Please try again.';
    }

    if (status >= 500) {
      this.logger.error(
        `${request?.method} ${request?.url} → ${status}: ${JSON.stringify(body)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${request?.method} ${request?.url} → ${status}: ${body.code} ${body.message}`);
    }

    response.status(status).json(body);
  }
}
