import { Injectable, LoggerService } from '@nestjs/common';
import { appLogger } from './pino.logger';

@Injectable()
export class NestPinoLogger implements LoggerService {
  log(message: unknown, context?: string) {
    appLogger.info(String(message), { context });
  }

  error(message: unknown, trace?: string, context?: string) {
    appLogger.error(String(message), { context, trace });
  }

  warn(message: unknown, context?: string) {
    appLogger.warn(String(message), { context });
  }

  debug(message: unknown, context?: string) {
    appLogger.debug(String(message), { context });
  }

  verbose(message: unknown, context?: string) {
    appLogger.verbose(String(message), { context });
  }
}
