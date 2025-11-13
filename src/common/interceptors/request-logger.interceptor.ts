/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { appLogger } from '../../logger/winston.logger';

type ReqWithIdUser = FastifyRequest & { id?: string; user?: any };

const PICK_HEADER_KEYS = [
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
  'content-type',
  'accept-language',
  'referer',
  'origin',
];

const SENSITIVE_HEADER_KEYS = new Set(['authorization', 'cookie', 'set-cookie']);
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'secret',
]);

function sanitizeHeaders(headers: Record<string, any>) {
  const picked: Record<string, any> = {};
  for (const key of PICK_HEADER_KEYS) {
    if ((headers as any)[key] !== undefined) picked[key] = (headers as any)[key];
  }
  for (const key of SENSITIVE_HEADER_KEYS) {
    if ((headers as any)[key] !== undefined) picked[key] = '[redacted]';
  }
  return picked;
}

function sanitizeBody(val: any, depth = 0): any {
  if (val == null) return val;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(val)) return val.slice(0, 20).map((v) => sanitizeBody(v, depth + 1));
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = SENSITIVE_BODY_KEYS.has(k.toLowerCase()) ? '[redacted]' : sanitizeBody(v, depth + 1);
    }
    return out;
  }
  if (typeof val === 'string' && val.length > 1000) return val.slice(0, 1000) + '…';
  return val;
}

function shouldLogBody(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<ReqWithIdUser>();
    const reply = http.getResponse<FastifyReply>();

    const id = (req.headers['x-request-id'] as string) || randomUUID();
    (req as any).id = id;
    reply.header('x-request-id', id);

    const method = req.method;
    const url = (req as any).originalUrl || req.url;
    const start = process.hrtime.bigint();

    const metaBase: Record<string, any> = {
      context: 'HTTP',
      requestId: id,
      userId: ((req as any).user && ((req as any).user.id ?? (req as any).user.sub)) || undefined,
      ip: (req as any).ip,
      headers: sanitizeHeaders(req.headers as any),
    };

    if (shouldLogBody(method)) {
      metaBase.body = sanitizeBody((req as any).body);
    }

    appLogger.info(`→ ${method} ${url}`, metaBase);

    return next.handle().pipe(
      tap(() => {
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        const statusCode = reply.statusCode;
        const contentLength = reply.getHeader('content-length') ?? undefined;
        appLogger.info(`← ${method} ${url} ${Math.round(durMs)}ms`, {
          ...metaBase,
          status: statusCode,
          contentLength,
        });
      }),
      catchError((err) => {
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        const status = err instanceof HttpException ? err.getStatus() : 500;

        appLogger.error(`✖ ${method} ${url} ${Math.round(durMs)}ms`, {
          ...metaBase,
          status,
          error: err instanceof HttpException ? err.getResponse() : (err?.message ?? String(err)),
          stack: err?.stack,
        });

        return throwError(() => err);
      }),
    );
  }
}
