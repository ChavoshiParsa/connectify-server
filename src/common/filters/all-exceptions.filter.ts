/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { appLogger } from '../../logger/winston.logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest & { id?: string; user?: any }>();
    const reply = ctx.getResponse<FastifyReply>();

    const method = req?.method ?? 'UNKNOWN';
    const url = (req as any)?.originalUrl || req?.url || 'UNKNOWN';
    const requestId = (req as any)?.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
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
      userId: ((req as any)?.user && ((req as any).user.id ?? (req as any).user.sub)) || undefined,
      error: errorPayload,
      stack: exception instanceof Error ? exception.stack : undefined,
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
      // ignore
    }
  }
}
