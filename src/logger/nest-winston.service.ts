import { Injectable, LoggerService } from '@nestjs/common';
import { appLogger } from './winston.logger';

@Injectable()
export class NestWinstonLogger implements LoggerService {
  log(message: string, context?: string) {
    appLogger.info(message, { context });
  }
  error(message: string, trace?: string, context?: string) {
    appLogger.error(message, { context, trace });
  }
  warn(message: string, context?: string) {
    appLogger.warn(message, { context });
  }
  debug(message: string, context?: string) {
    appLogger.debug(message, { context });
  }
  verbose(message: string, context?: string) {
    appLogger.verbose(message, { context });
  }
}
