/**
 * @file rateLimiter.js
 * @description Express rate limiting — global limiter + stricter limits for AI endpoints
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import rateLimit from 'express-rate-limit';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10);

export const globalRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later', code: 429 },
});

export const claudeRateLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { success: false, error: 'Claude chat rate limit exceeded', code: 429 },
});
