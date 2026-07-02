import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger as PinoBaseLogger } from 'pino';
import pino from 'pino';
import { IS_PROD, NODE_ENV } from 'src/env';

type LogMeta = Record<string, unknown>;
type LogValue = string | number | boolean | bigint | symbol | null | undefined | Error | object;

const redactPaths = [
  'password',
  'passwordHash',
  'hashedRt',
  'refreshToken',
  'accessToken',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'headers.authorization',
  'headers.cookie',
  'headers.set-cookie',
  'body.password',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
  'body.deviceId',
  '*.password',
  '*.passwordHash',
  '*.hashedRt',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
];

const LOG_DIR = join(process.cwd(), 'logs');

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const consoleStream = IS_PROD
  ? process.stdout
  : pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        levelFirst: true,
        translateTime: 'SYS:standard',
        singleLine: false,
        ignore: 'pid,hostname',
      },
    });

const appFileStream = pino.destination({
  dest: join(LOG_DIR, 'app.log'),
  sync: false,
});

const errorFileStream = pino.destination({
  dest: join(LOG_DIR, 'error.log'),
  sync: false,
});

const logStreams = pino.multistream([
  {
    level: process.env.LOG_LEVEL ?? (IS_PROD ? 'info' : 'debug'),
    stream: consoleStream,
  },
  {
    level: 'debug',
    stream: appFileStream,
  },
  {
    level: 'error',
    stream: errorFileStream,
  },
]);

const rootLogger = pino(
  {
    level: process.env.LOG_LEVEL ?? (IS_PROD ? 'info' : 'debug'),
    base: {
      service: process.env.SERVICE_NAME ?? 'connectify-server',
      env: NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    redact: {
      paths: redactPaths,
      censor: '[redacted]',
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  logStreams,
);

function isPlainMeta(value: unknown): value is LogMeta {
  return Boolean(value) && typeof value === 'object' && !(value instanceof Error);
}

function normalizeMeta(meta?: LogValue): LogMeta | undefined {
  if (!meta) return undefined;
  if (meta instanceof Error) return { err: meta };
  if (isPlainMeta(meta)) return meta;
  return { value: meta };
}

function write(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: unknown, meta?: LogValue) {
  const normalizedMeta = normalizeMeta(meta);
  const msg = typeof message === 'string' ? message : JSON.stringify(message);

  if (normalizedMeta) {
    rootLogger[level](normalizedMeta, msg);
    return;
  }

  rootLogger[level](msg);
}

export const appLogger = {
  raw: rootLogger,

  child(bindings: LogMeta) {
    const childLogger = rootLogger.child(bindings);
    return createCompatLogger(childLogger);
  },

  trace(message: unknown, meta?: LogValue) {
    write('trace', message, meta);
  },

  debug(message: unknown, meta?: LogValue) {
    write('debug', message, meta);
  },

  info(message: unknown, meta?: LogValue) {
    write('info', message, meta);
  },

  warn(message: unknown, meta?: LogValue) {
    write('warn', message, meta);
  },

  error(message: unknown, meta?: LogValue) {
    write('error', message, meta);
  },

  fatal(message: unknown, meta?: LogValue) {
    write('fatal', message, meta);
  },

  verbose(message: unknown, meta?: LogValue) {
    write('trace', message, meta);
  },
};

function createCompatLogger(logger: PinoBaseLogger) {
  const childWrite = (
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: unknown,
    meta?: LogValue,
  ) => {
    const normalizedMeta = normalizeMeta(meta);
    const msg = typeof message === 'string' ? message : JSON.stringify(message);

    if (normalizedMeta) {
      logger[level](normalizedMeta, msg);
      return;
    }

    logger[level](msg);
  };

  return {
    trace: (message: unknown, meta?: LogValue) => childWrite('trace', message, meta),
    debug: (message: unknown, meta?: LogValue) => childWrite('debug', message, meta),
    info: (message: unknown, meta?: LogValue) => childWrite('info', message, meta),
    warn: (message: unknown, meta?: LogValue) => childWrite('warn', message, meta),
    error: (message: unknown, meta?: LogValue) => childWrite('error', message, meta),
    fatal: (message: unknown, meta?: LogValue) => childWrite('fatal', message, meta),
    verbose: (message: unknown, meta?: LogValue) => childWrite('trace', message, meta),
  };
}
