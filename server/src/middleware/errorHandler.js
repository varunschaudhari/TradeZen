/**
 * @file errorHandler.js
 * @description Global Express error handler — never leaks internal details to client
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import { logger } from '../config/logger.js';

/**
 * Express 5 async-compatible error handler middleware
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export const errorHandler = (err, req, res, _next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
  });

  const statusCode = err.statusCode ?? err.status ?? 500;
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(statusCode).json({
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    code: statusCode,
  });
};
