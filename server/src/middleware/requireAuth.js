/**
 * @file requireAuth.js
 * @description Verifies the httpOnly session cookie and attaches req.userId /
 *   req.userRole. Applied globally in app.js (after the auth routes themselves,
 *   which must stay reachable without a session).
 * @author TradeZen Team
 */

import { verifyToken, AUTH_COOKIE_NAME } from '../services/authService.js';

export const requireAuth = (req, res, next) => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  const claims = verifyToken(token);
  if (!claims) {
    return res.status(401).json({ success: false, error: 'Not authenticated', code: 401 });
  }
  req.userId = claims.userId;
  next();
};
