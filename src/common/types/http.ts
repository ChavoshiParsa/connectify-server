import type { FastifyReply, FastifyRequest } from 'fastify';

export type RequestUser = {
  userId: string;
  email: string;
  deviceId?: string;
  refreshToken?: string;
  id?: string;
  sub?: string;
};

export type AppFastifyRequest = FastifyRequest & {
  id?: string;
  user?: RequestUser;
  cookies?: Record<string, string | undefined>;
};

export type AppFastifyReply = FastifyReply;

export function getHeader(req: FastifyRequest, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export function getClientIp(req: FastifyRequest): string {
  const forwardedFor = getHeader(req, 'x-forwarded-for');
  const realIp = getHeader(req, 'x-real-ip');

  return forwardedFor?.split(',')[0]?.trim() || realIp || req.ip || req.socket.remoteAddress || 'unknown';
}

export function getUserAgent(req: FastifyRequest): string {
  return getHeader(req, 'user-agent') || 'unknown';
}
