/**
 * @file App.jsx
 * @description Root component — sets up React Router, AppContext provider, and shared Layout
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-15
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import Layout from './components/Layout.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Dashboard from './pages/Dashboard.jsx';
import StockDetail from './pages/StockDetail.jsx';
import AnalysisReport from './pages/AnalysisReport.jsx';
import Signals from './pages/Signals.jsx';
import ScanResults from './pages/ScanResults.jsx';
import Monitor from './pages/Monitor.jsx';
import Stocks from './pages/Stocks.jsx';
import Positions from './pages/Positions.jsx';
import Performance from './pages/Performance.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Universe from './pages/Universe.jsx';
import Settings from './pages/Settings.jsx';
import RiskDashboard from './pages/RiskDashboard.jsx';
import Backtest from './pages/Backtest.jsx';
import GateAnalytics from './pages/GateAnalytics.jsx';

const App = () => (
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
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"    element={<ErrorBoundary label="Dashboard"><Dashboard /></ErrorBoundary>} />
            <Route path="/stock/:symbol" element={<ErrorBoundary label="Stock Detail"><StockDetail /></ErrorBoundary>} />
            <Route path="/analysis/:symbol" element={<ErrorBoundary label="Analysis Report"><AnalysisReport /></ErrorBoundary>} />
            <Route path="/signals"      element={<ErrorBoundary label="Signals"><Signals /></ErrorBoundary>} />
            <Route path="/scan"         element={<ErrorBoundary label="Scan Results"><ScanResults /></ErrorBoundary>} />
            <Route path="/stocks"       element={<ErrorBoundary label="Stocks"><Stocks /></ErrorBoundary>} />
            <Route path="/monitor"      element={<ErrorBoundary label="Monitor"><Monitor /></ErrorBoundary>} />
            <Route path="/positions"    element={<ErrorBoundary label="Positions"><Positions /></ErrorBoundary>} />
            <Route path="/performance"  element={<ErrorBoundary label="Performance"><Performance /></ErrorBoundary>} />
            <Route path="/watchlist"    element={<ErrorBoundary label="Watchlist"><Watchlist /></ErrorBoundary>} />
            <Route path="/universe"     element={<ErrorBoundary label="Universe"><Universe /></ErrorBoundary>} />
            <Route path="/risk"         element={<ErrorBoundary label="Risk Dashboard"><RiskDashboard /></ErrorBoundary>} />
            <Route path="/backtest"     element={<ErrorBoundary label="Backtesting"><Backtest /></ErrorBoundary>} />
            <Route path="/gates"        element={<ErrorBoundary label="Gate Analytics"><GateAnalytics /></ErrorBoundary>} />
            <Route path="/settings"     element={<ErrorBoundary label="Settings"><Settings /></ErrorBoundary>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Layout>
      </NotificationProvider>
    </BrowserRouter>
  </AppProvider>
);

export default App;
