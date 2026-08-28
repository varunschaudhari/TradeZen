/**
 * @file App.jsx
 * @description Root component — sets up React Router, AppContext provider, and shared Layout
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import React from 'react';
import PropTypes from 'prop-types';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import Layout from './components/Layout.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SwingTrading from './pages/SwingTrading.jsx';
import IntradayTrading from './pages/IntradayTrading.jsx';
import StockDetail from './pages/StockDetail.jsx';
import AnalysisReport from './pages/AnalysisReport.jsx';
import Signals from './pages/Signals.jsx';
import ScanResults from './pages/ScanResults.jsx';
import Monitor from './pages/Monitor.jsx';
import Stocks from './pages/Stocks.jsx';
import Positions from './pages/Positions.jsx';
import Performance from './pages/Performance.jsx';
import TradeLedger from './pages/TradeLedger.jsx';
import RiskAttribution from './pages/RiskAttribution.jsx';
import GoLiveEvidence from './pages/GoLiveEvidence.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Universe from './pages/Universe.jsx';
import Settings from './pages/Settings.jsx';
import RiskDashboard from './pages/RiskDashboard.jsx';
import Backtest from './pages/Backtest.jsx';
import GateAnalytics from './pages/GateAnalytics.jsx';
import Alerts from './pages/Alerts.jsx';
import HolidayCalendar from './pages/HolidayCalendar.jsx';
import GoalTracker from './pages/GoalTracker.jsx';

/** Redirects to /login (remembering where the user was headed) when not authenticated. */
const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
};

RequireAuth.propTypes = { children: PropTypes.node.isRequired };

const App = () => (
  <AuthProvider>
    <AppProvider>
      <BrowserRouter>
        <NotificationProvider>
          <CommandPalette />
          <ShortcutsModal />
          <Toaster
            position="bottom-center"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid rgba(148,163,184,0.15)',
                borderRadius: '10px',
                fontSize: '13px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(12px)',
              },
              success: {
                iconTheme: { primary: '#22c55e', secondary: '#1e293b' },
              },
              error: {
                iconTheme: { primary: '#ef4444', secondary: '#1e293b' },
              },
            }}
          />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard"    element={<ErrorBoundary label="Dashboard"><Dashboard /></ErrorBoundary>} />
                      <Route path="/swing-trading"    element={<ErrorBoundary label="Swing Trading"><SwingTrading /></ErrorBoundary>} />
                      <Route path="/intraday-trading" element={<ErrorBoundary label="Intraday Trading"><IntradayTrading /></ErrorBoundary>} />
                      <Route path="/stock/:symbol" element={<ErrorBoundary label="Stock Detail"><StockDetail /></ErrorBoundary>} />
                      <Route path="/analysis/:symbol" element={<ErrorBoundary label="Analysis Report"><AnalysisReport /></ErrorBoundary>} />
                      <Route path="/signals"      element={<ErrorBoundary label="Signals"><Signals /></ErrorBoundary>} />
                      <Route path="/scan"         element={<ErrorBoundary label="Scan Results"><ScanResults /></ErrorBoundary>} />
                      <Route path="/stocks"       element={<ErrorBoundary label="Stocks"><Stocks /></ErrorBoundary>} />
                      <Route path="/monitor"      element={<ErrorBoundary label="Monitor"><Monitor /></ErrorBoundary>} />
                      <Route path="/positions"    element={<ErrorBoundary label="Positions"><Positions /></ErrorBoundary>} />
                      <Route path="/performance"  element={<ErrorBoundary label="Performance"><Performance /></ErrorBoundary>} />
                      <Route path="/goal"         element={<ErrorBoundary label="Goal Tracker"><GoalTracker /></ErrorBoundary>} />
                      <Route path="/trade-ledger" element={<ErrorBoundary label="Trade Ledger"><TradeLedger /></ErrorBoundary>} />
                      <Route path="/risk-attribution" element={<ErrorBoundary label="Risk & Attribution"><RiskAttribution /></ErrorBoundary>} />
                      <Route path="/go-live-evidence" element={<ErrorBoundary label="Go-Live Evidence"><GoLiveEvidence /></ErrorBoundary>} />
                      <Route path="/watchlist"    element={<ErrorBoundary label="Watchlist"><Watchlist /></ErrorBoundary>} />
                      <Route path="/universe"     element={<ErrorBoundary label="Universe"><Universe /></ErrorBoundary>} />
                      <Route path="/risk"         element={<ErrorBoundary label="Risk Dashboard"><RiskDashboard /></ErrorBoundary>} />
                      <Route path="/backtest"     element={<ErrorBoundary label="Backtesting"><Backtest /></ErrorBoundary>} />
                      <Route path="/gates"        element={<ErrorBoundary label="Gate Analytics"><GateAnalytics /></ErrorBoundary>} />
                      <Route path="/alerts"       element={<ErrorBoundary label="Alerts"><Alerts /></ErrorBoundary>} />
                      <Route path="/holidays"     element={<ErrorBoundary label="Holiday Calendar"><HolidayCalendar /></ErrorBoundary>} />
                      <Route path="/settings"     element={<ErrorBoundary label="Settings"><Settings /></ErrorBoundary>} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </Layout>
                </RequireAuth>
              }
            />
          </Routes>
        </NotificationProvider>
      </BrowserRouter>
    </AppProvider>
  </AuthProvider>
);

export default App;
