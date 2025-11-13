import '@fastify/cookie';
import { CookieSerializeOptions } from '@fastify/cookie';
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    cookies: { [key: string]: string | undefined };
    user?: {
      userId: string;
      email: string;
      refreshToken: string;
      deviceId: string;
    };
    id?: string;
  }

  interface FastifyReply {
    setCookie(name: string, value: string, options?: CookieSerializeOptions): FastifyReply;
    clearCookie(name: string, options?: CookieSerializeOptions): FastifyReply;
  }
}
