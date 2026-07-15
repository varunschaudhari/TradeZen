/**
 * @file auth.js
 * @description Login/logout/session-check. No public signup — accounts are created
 *   via scripts/create-user.mjs only.
 *   POST /api/auth/login  — email + password → httpOnly session cookie
 *   POST /api/auth/logout — clears the session cookie
 *   GET  /api/auth/me     — current session's user, 401 if none
 * @author TradeZen Team
 */

import express from 'express';
import Joi from 'joi';
import User from '../models/User.js';
import { validateBody } from '../middleware/validateRequest.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyPassword, signToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS } from '../services/authService.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(1).required(),
});

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: AUTH_COOKIE_MAX_AGE_MS,
};

// POST /api/auth/login
router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    const valid = user && (await verifyPassword(password, user.passwordHash));
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password', code: 401 });
    }
    const token = signToken(user._id);
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions);
    logger.info('User logged in', { userId: user._id, email: user.email });
    res.json({
      success: true,
      data: { _id: user._id, email: user.email, name: user.name, role: user.role },
      message: 'Logged in',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions);
  res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('email name role').lean();
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated', code: 401 });
    res.json({ success: true, data: user, message: 'Current user' });
  } catch (err) {
    next(err);
  }
});

export default router;
