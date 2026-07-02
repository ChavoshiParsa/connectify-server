import '@fastify/cookie';
import 'fastify';
import type { RequestUser } from 'src/common/types/http';

declare module 'fastify' {
  interface FastifyRequest {
    id?: string;
    user?: RequestUser;
  }
}
