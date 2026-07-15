/**
 * @file Login.jsx
 * @description Email/password login — no public signup, accounts are admin-provisioned
 *   via server/scripts/create-user.mjs.
 * @author TradeZen Team
 * @created 2026-07-10
 */

import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const Login = () => {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const to = location.state?.from ?? '/dashboard';
    return <Navigate to={to} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message ?? 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">TradeZen</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs text-slate-400 mb-1">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="input w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-slate-500">
          No account? Ask your admin to provision one — there's no public signup.
        </p>
      </div>
    </div>
  );
};

export default Login;
