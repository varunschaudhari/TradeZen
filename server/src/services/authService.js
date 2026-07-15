/**
 * @file authService.js
 * @description Password hashing + JWT session tokens. Pure crypto helpers — no DB
 *   access, no Express types — so they're usable from routes, middleware, the socket
 *   handshake, and CLI scripts alike.
 * @author TradeZen Team
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
};

/** @param {string} plain @returns {Promise<string>} */
export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

/** @param {string} plain @param {string} hash @returns {Promise<boolean>} */
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** @param {string} userId @returns {string} signed JWT, 7-day expiry */
export const signToken = (userId) => jwt.sign({ sub: String(userId) }, secret(), { expiresIn: TOKEN_EXPIRY });

/**
 * @param {string} token
 * @returns {{ userId: string }|null} null on any verification failure (expired, tampered, malformed)
 */
export const verifyToken = (token) => {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return { userId: payload.sub };
  } catch {
    return null;
  }
};

export const AUTH_COOKIE_NAME = 'token';
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
