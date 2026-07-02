/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { appLogger } from '../../logger/pino.logger';
import type { AppFastifyReply, AppFastifyRequest } from '../types/http';

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
  'accessToken',
  'refreshToken',
  'client_secret',
  'secret',
  'hashedRt',
  'passwordHash',
]);

function sanitizeHeaders(headers: Record<string, any>) {
  const picked: Record<string, any> = {};
  for (const key of PICK_HEADER_KEYS) {
    if (headers[key] !== undefined) picked[key] = headers[key];
  }
  for (const key of SENSITIVE_HEADER_KEYS) {
    if (headers[key] !== undefined) picked[key] = '[redacted]';
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
    const req = http.getRequest<AppFastifyRequest>();
    const reply = http.getResponse<AppFastifyReply>();

    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID();
    req.id = requestId;
    reply.header('x-request-id', requestId);

    const method = req.method;
    const url = req.url;
    const start = process.hrtime.bigint();

    const metaBase: Record<string, any> = {
      context: 'HTTP',
      requestId,
      userId: (req.user && (req.user.id ?? req.user.sub ?? req.user.userId)) || undefined,
      ip: req.ip,
      headers: sanitizeHeaders(req.headers),
    };

    if (shouldLogBody(method)) {
      metaBase.body = sanitizeBody(req.body);
    }

    appLogger.info(`→ ${method} ${url}`, metaBase);

    return next.handle().pipe(
      tap(() => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

        appLogger.info(`← ${method} ${url} ${Math.round(durationMs)}ms`, {
          ...metaBase,
          status: reply.statusCode,
          durationMs: Math.round(durationMs),
          contentLength: reply.getHeader('content-length') ?? undefined,
        });
      }),
      catchError((err) => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const status = err instanceof HttpException ? err.getStatus() : 500;

        appLogger.error(`✖ ${method} ${url} ${Math.round(durationMs)}ms`, {
          ...metaBase,
          status,
          durationMs: Math.round(durationMs),
          error: err instanceof HttpException ? err.getResponse() : (err?.message ?? String(err)),
          err: err instanceof Error ? err : undefined,
        });

        return throwError(() => err);
      }),
    );
  }
}
