/**
 * @file logger.js
 * @description Winston structured logger — JSON in production, colorized in development
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), json()),
  defaultMeta: { service: 'swing-trader-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (isDevelopment) {
  logger.add(new winston.transports.Console({ format: combine(colorize(), simple()) }));
}

export { logger };
