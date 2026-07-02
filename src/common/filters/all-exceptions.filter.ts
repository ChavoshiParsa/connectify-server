/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { AppFastifyReply, AppFastifyRequest } from '../types/http';
import { appLogger } from '../../logger/pino.logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AppFastifyRequest>();
    const reply = ctx.getResponse<AppFastifyReply>();

    const method = req?.method ?? 'UNKNOWN';
    const url = req?.url || 'UNKNOWN';
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
      userId: (req?.user && (req.user.id ?? req.user.sub ?? req.user.userId)) || undefined,
      error: errorPayload,
      err: exception instanceof Error ? exception : undefined,
    });

    try {
      if (!reply.sent) {
        reply.status(status).send({
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
