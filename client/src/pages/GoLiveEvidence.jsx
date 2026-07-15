/**
 * @file GoLiveEvidence.jsx
 * @description The evidence-based case for (or against) trading this system with real
 *   capital: the per-lane go-live gate plus the discipline ledger's measured value of
 *   every trade the system refused to take.
 * @author SwingTrader AI Team
 */

import React, { useState, useEffect, useCallback } from 'react';
import { intradayApi, disciplineApi } from '../services/api.js';
import GoLiveGateCard from '../components/GoLiveGateCard.jsx';
import DisciplineLedgerCard from '../components/DisciplineLedgerCard.jsx';

const GoLiveEvidence = () => {
  const [goLiveGate, setGoLiveGate] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gateRes, ledgerRes] = await Promise.all([
        intradayApi.getGoLive().catch(() => null),
        disciplineApi.get().catch(() => null),
      ]);
      setGoLiveGate(gateRes?.data ?? null);
      setLedger(ledgerRes?.data ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  const hasAnything = goLiveGate || (ledger?.summary && ledger.summary.totalBlocked > 0);

  return (
    <div className="min-h-screen bg-surface p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-100">Go-Live Evidence</h1>
        <button onClick={load} className="btn-primary text-xs px-3 py-1">Refresh</button>
      </div>

      {error && <div className="card border-red-500/30 bg-red-500/10 text-red-400">{error}</div>}

      {!hasAnything ? (
        <div className="card text-center py-14">
          <p className="text-4xl mb-3">🧾</p>
          <p className="text-slate-400 font-medium">No evidence yet</p>
          <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
            The go-live gate and discipline ledger fill in as signals settle and trades close.
          </p>
        </div>
      ) : (
        <>
          <GoLiveGateCard gate={goLiveGate} />
          <DisciplineLedgerCard ledger={ledger} />
        </>
      )}
    </div>
  );
};

export default GoLiveEvidence;
