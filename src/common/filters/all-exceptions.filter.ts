/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { appLogger } from '../../logger/winston.logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string; user?: any }>();
    const res = ctx.getResponse<Response>();

    const method = req?.method ?? 'UNKNOWN';
    const url = req?.originalUrl || req?.url || 'UNKNOWN';
    const requestId = req?.id;

    let status = 500;
    let errorPayload: any = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      errorPayload = typeof resp === 'string' ? resp : resp;
    } else if (exception instanceof Error) {
      errorPayload = exception.message;
    }

    appLogger.error(`✖ ${method} ${url}`, {
      context: 'HTTP',
      requestId,
      status,
      userId: (req?.user && (req.user.id ?? req.user.sub)) || undefined,
      error: errorPayload,
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    try {
      if (!res.headersSent) {
        res.status(status).json({
          statusCode: status,
          message: typeof errorPayload === 'string' ? errorPayload : (errorPayload?.message ?? 'Error'),
          requestId,
          path: url,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore write errors.
    }
  }
}
