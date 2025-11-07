import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';

const tehranTimestamp = format.timestamp({
  format: () =>
    new Date().toLocaleString('sv-SE', {
      timeZone: 'Asia/Tehran',
      hour12: false,
    }),
});

const logFormat = format.printf(({ level, message, timestamp, context, ...meta }) => {
  const ctx = context ? ` [${context as string}]` : '';
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp as string} ${level.toUpperCase()}${ctx}: ${message as string}${extra}`;
});

const fileTransport = new transports.DailyRotateFile({
  dirname: 'logs',
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '50m',
  maxFiles: '30d',
  level: 'info',
});

export const appLogger = createLogger({
  level: 'info',
  format: format.combine(tehranTimestamp, format.errors({ stack: true }), logFormat),
  transports: [
    fileTransport,
    new transports.Console({
      format: format.combine(format.colorize(), tehranTimestamp, logFormat),
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),
  ],
});
