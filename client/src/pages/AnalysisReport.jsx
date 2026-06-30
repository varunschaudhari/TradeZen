/**
 * @file AnalysisReport.jsx
 * @description Comprehensive 10-section analysis report for single stock
 * Tiered view: Quick (KPIs) / Detailed (Technical) / Advanced (Strategy)
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { analysisApi } from '../services/api.js';
import { formatCurrency, formatPercent } from '../utils/formatters.js';

/**
 * Catches render errors in a section/tab so one bad section shows a readable message
 * instead of blanking the whole page. Resets when `resetKey` changes (e.g. tab switch).
 */
class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card border-bear/30 bg-bear/10 text-bear text-sm">
          <p className="font-semibold mb-1">⚠️ This section failed to render.</p>
          <p className="text-xs text-bear/80 font-mono break-all">{String(this.state.error?.message ?? this.state.error)}</p>
          <p className="text-xs text-slate-400 mt-2">The rest of the report is unaffected — switch tabs or reload to retry.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const AnalysisReport = () => {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const sym = (symbol ?? '').toUpperCase();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('quick'); // quick | detailed | advanced

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await analysisApi.getReport(sym);
        setReport(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (sym) load();
  }, [sym]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage error={error} sym={sym} />;
  if (!report) return <div className="p-6 text-center text-slate-500">No data available</div>;

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-slate-400 hover:text-slate-200 mb-2"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold font-mono text-slate-100">{sym}</h1>
          <p className="text-sm text-slate-500 mt-1">Comprehensive Analysis Report</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold text-accent">{formatCurrency(report.metadata.currentPrice)}</div>
          <div className="text-sm text-slate-400 mt-1">Simons: {Math.round(report.metadata.simonScore)}/100</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-slate-700/50">
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'quick'
              ? 'text-accent border-b-2 border-accent'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          🚀 Quick View
        </button>
        <button
          onClick={() => setActiveTab('detailed')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'detailed'
              ? 'text-accent border-b-2 border-accent'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          📊 Detailed Analysis
        </button>
        <button
          onClick={() => setActiveTab('advanced')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'advanced'
              ? 'text-accent border-b-2 border-accent'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ⚡ Advanced Strategy
        </button>
      </div>

      {/* Content */}
      <SectionErrorBoundary resetKey={activeTab}>
        {activeTab === 'quick' && <QuickView report={report} />}
        {activeTab === 'detailed' && <DetailedView report={report} />}
        {activeTab === 'advanced' && <AdvancedView report={report} />}
      </SectionErrorBoundary>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

function QuickView({ report }) {
  const r1 = report.section1_timeframe;
  const r3 = report.section3_riskMetrics;
  const r10 = report.section10_profitStrategy;

  return (
    <div className="space-y-4">
      {/* Entry/Exit Levels */}
      <Card title="📍 Trade Setup">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricBox label="Entry" value={report.metadata.currentPrice} color="accent" />
          <MetricBox label="Target 1" value={r1.t1_details.return_pct} suffix="%" color="bull" />
          <MetricBox label="Target 2" value={r1.t2_details.return_pct} suffix="%" color="bull" />
          <MetricBox label="Stop Loss" value={r3.max_drawdown_risk_pct} suffix="%" color="bear" />
        </div>
      </Card>

      {/* Timeframe */}
      <Card title="⏱️ Hold Duration">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase">To Target 1</p>
            <p className="text-lg font-mono font-bold text-slate-100">{r1.t1_details.hold_days} days</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase">To Target 2</p>
            <p className="text-lg font-mono font-bold text-slate-100">{r1.t2_details.hold_days} days</p>
          </div>
        </div>
      </Card>

      {/* Risk/Reward */}
      <Card title="⚖️ Risk vs Reward">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500">Risk:Reward T1</p>
            <p className="text-2xl font-bold text-accent">{r3.risk_reward_t1}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Risk:Reward T2</p>
            <p className="text-2xl font-bold text-accent">{r3.risk_reward_t2}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Expected Value</p>
            <p className={`text-2xl font-bold ${r3.expected_value_pct > 0 ? 'text-bull' : 'text-bear'}`}>
              {r3.expected_value_pct}%
            </p>
          </div>
        </div>
      </Card>

      {/* Recommendation */}
      <Card title="💡 Recommended Strategy">
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
          <p className="font-semibold text-accent mb-2">{r10.recommended}</p>
          <p className="text-sm text-slate-300">
            Exit {r10.balanced_approach.exit_plan}
          </p>
          <p className="text-xs text-slate-500 mt-2">Expected average return: {r10.expected_avg_return}%</p>
        </div>
      </Card>
    </div>
  );
}

function DetailedView({ report }) {
  const sym = report.symbol; // used by checklist / peer / alerts sections below
  const r2 = report.section2_confidence;
  const r4 = report.section4_scenarios;
  const r7 = report.section7_earningsRisk;
  const r9 = report.section9_marketImpact;

  return (
    <div className="space-y-4">
      {/* Confidence */}
      <Card title="🎯 Signal Strength">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Simons Score</span>
            <span className="font-mono font-bold text-accent">{report.metadata.simonScore}/100</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Claude Confidence</span>
            <Badge text={r2.claude_confidence} type={r2.claude_confidence} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Assessment</span>
            <span className="text-sm text-slate-200">{r2.overall_assessment}</span>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 uppercase mb-2">Supporting Factors</p>
          <div className="space-y-1">
            {r2.supporting_factors.map((f, i) => (
              <div key={i} className="text-xs flex justify-between">
                <span className="text-slate-400">{f.check}</span>
                <span>{f.status}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Scenarios */}
      <Card title="📈 Outcome Scenarios">
        {['best_case', 'base_case', 'worst_case'].map((key) => {
          const scenario = r4[key];
          const color = key === 'best_case' ? 'bull' : key === 'base_case' ? 'accent' : 'bear';
          return (
            <div key={key} className={`mb-3 pb-3 border-b border-slate-700/50 last:border-0 last:mb-0`}>
              <div className="flex justify-between items-start mb-1">
                <span className="text-sm font-semibold capitalize text-slate-300">{key.replace('_', ' ')}</span>
                <span className={`text-xs font-mono text-${color}`}>{scenario.probability_pct}%</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">{scenario.condition}</p>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Target: {formatCurrency(scenario.target)}</span>
                <span className={`font-bold text-${color}`}>{scenario.return_pct}%</span>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Earnings Risk */}
      <Card title="⚠️ Event Risk">
        <div className={`bg-${r7.risk_level === 'CRITICAL' ? 'bear' : r7.risk_level === 'HIGH' ? 'wait' : 'bull'}/10 border border-${r7.risk_level === 'CRITICAL' ? 'bear' : r7.risk_level === 'HIGH' ? 'wait' : 'bull'}/30 rounded-lg p-3`}>
          <p className="text-sm font-semibold mb-1">{r7.risk_level}: {r7.message}</p>
          {r7.recommendation && (
            <p className="text-xs text-slate-300">{r7.recommendation}</p>
          )}
        </div>
      </Card>

      {/* Market Context */}
      <Card title="🌍 Market Mode Impact">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Current Mode</span>
            <Badge text={r9.current_market_mode} />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Signal Quality</span>
            <span className="font-mono text-accent">{r9.signal_quality_modifier}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">T2 Probability</span>
            <span className="font-mono text-accent">{r9.r2_probability}</span>
          </div>
        </div>
      </Card>

      {/* Historical Backtest */}
      <BacktestSection backtest={report.section11_backtest} />

      {/* Liquidity Analysis */}
      <LiquiditySection liquidity={report.section12_liquidity} />

      {/* Portfolio Stress Test */}
      <PortfolioStressSection stress={report.section13_portfolioStress} />

      {/* Earnings Impact */}
      <EarningsSection earnings={report.section14_earnings} />

      {/* Execution Checklist */}
      <ExecutionChecklistSection checklist={report.section15_checklist} symbol={sym} />

      {/* TIER 2: Professional Polish */}

      {/* Risk Heat Map */}
      <RiskHeatMapSection heatMap={report.section16_riskHeatMap} />

      {/* Price Level Heat Map */}
      <PriceLevelHeatMapSection priceMap={report.section17_priceLevelHeatMap} />

      {/* Peer Comparison */}
      <PeerComparisonSection peers={report.section18_peerComparison} symbol={sym} />

      {/* Alerts & Notifications */}
      <AlertsSection alerts={report.section19_alerts} symbol={sym} />

      {/* TIER 3: Advanced Analytics */}

      {/* Monte Carlo Simulation */}
      <MonteCarloSection monteCarlo={report.section20_monteCarlo} />

      {/* Trade Journal */}
      <TradeJournalSection journal={report.section21_tradeJournal} />

      {/* Sector Momentum */}
      <SectorMomentumSection sector={report.section22_sectorMomentum} />

      {/* Volatility Surface */}
      <VolatilitySurfaceSection vol={report.section23_volatilitySurface} />
    </div>
  );
}

function AdvancedView({ report }) {
  const r5 = report.section5_entryOptions;
  const r6 = report.section6_trailingStops;
  const r8 = report.section8_patterns;
  const r10 = report.section10_profitStrategy;

  return (
    <div className="space-y-4">
      {/* Entry Options */}
      <Card title="🎯 Entry Aggressiveness Slider">
        {['conservative', 'standard', 'aggressive'].map((approach) => {
          const option = r5[approach];
          const isRec = r5.recommended.includes(approach);
          return (
            <div
              key={approach}
              className={`mb-3 pb-3 border-l-2 pl-3 ${isRec ? 'border-accent' : 'border-slate-700'} ${isRec ? 'bg-accent/5' : ''}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold capitalize text-slate-200">{approach}</span>
                {isRec && <Badge text="Recommended" type="accent" />}
              </div>
              <p className="text-xs text-slate-500 mb-2">Entry: {formatCurrency(option.entry_price)}</p>
              <p className="text-xs text-slate-400">Position: {option.position_size_pct}</p>
            </div>
          );
        })}
      </Card>

      {/* Trailing Stops */}
      <Card title="📍 Trailing Stop Plan">
        <div className="space-y-2">
          <div className="bg-slate-800/50 rounded p-2 mb-2">
            <p className="text-xs text-slate-500">Initial SL</p>
            <p className="text-lg font-mono font-bold text-bear">{formatCurrency(r6.initial_sl)}</p>
          </div>
          {[1, 2, 3].map((step) => {
            const s = r6[`step_${step}`];
            return (
              <div key={step} className="flex justify-between items-start text-xs border-b border-slate-700/50 pb-2 last:border-0">
                <div>
                  <p className="text-slate-500">Step {step}</p>
                  <p className="text-slate-400">{s.reason}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-accent">+{s.trigger_profit_pct}%</p>
                  <p className="font-mono text-slate-400">SL → {formatCurrency(s.new_sl)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Pattern Comparison */}
      <Card title="📚 Pattern History">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Similar Setups (90d)</p>
            <p className="text-2xl font-bold text-slate-100">{r8.similar_setups_90d}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Success Rate</p>
            <p className="text-2xl font-bold text-bull">{r8.success_rate_pct}%</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">{r8.pattern_assessment}</p>
      </Card>

      {/* Profit Strategies */}
      <Card title="💰 Profit-Taking Strategies">
        {['aggressive_approach', 'balanced_approach', 'conservative_approach'].map((key) => {
          const strategy = r10[key];
          const isRec = r10.recommended.includes(key.split('_')[0]);
          return (
            <div
              key={key}
              className={`mb-3 pb-3 border-b border-slate-700/50 last:border-0 ${isRec ? 'bg-accent/5 px-2 py-1 -mx-2 border-l-2 border-accent' : ''}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-slate-200">{strategy.name}</p>
                  <p className="text-xs text-slate-500">{strategy.exit_plan}</p>
                </div>
                {isRec && <Badge text="Recommended" type="accent" />}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-200 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function MetricBox({ label, value, suffix = '', color = 'slate' }) {
  const colors = {
    accent: 'text-accent',
    bull: 'text-bull',
    bear: 'text-bear',
    slate: 'text-slate-100',
  };

  return (
    <div className="bg-slate-800/50 rounded-lg p-3">
      <p className="text-xs uppercase text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-mono font-bold ${colors[color]}`}>
        {typeof value === 'number' ? formatCurrency(value) : value}
        {suffix}
      </p>
    </div>
  );
}

function Badge({ text, type = 'slate' }) {
  const colors = {
    HIGH: 'bg-bull/15 text-bull',
    MEDIUM: 'bg-wait/15 text-wait',
    LOW: 'bg-bear/15 text-bear',
    accent: 'bg-accent/15 text-accent',
    bull: 'bg-bull/15 text-bull',
    bear: 'bg-bear/15 text-bear',
    slate: 'bg-slate-700/50 text-slate-400',
  };

  return <span className={`chip ${colors[type] || colors.slate}`}>{text}</span>;
}

function ExecutionChecklistSection({ checklist, symbol }) {
  const [checkedItems, setCheckedItems] = React.useState(new Set());
  const [copied, setCopied] = React.useState(false);

  if (!checklist) {
    return (
      <Card title="✅ Execution Checklist">
        <div className="text-sm text-slate-400">Checklist data unavailable</div>
      </Card>
    );
  }

  const toggleCheck = (id) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedItems(newChecked);
  };

  const copyToClipboard = async () => {
    // Create plain text version for copy-paste
    const text = `EXECUTION CHECKLIST: ${symbol}
Generated: ${new Date().toLocaleString()}

═══════════════════════════════════════════════════════
RISK METRICS
═══════════════════════════════════════════════════════
Entry: ₹${checklist.riskMetrics.entry.toFixed(2)}
Stop Loss: ₹${checklist.riskMetrics.stopLoss.toFixed(2)}
Target 1: ₹${checklist.riskMetrics.target1.toFixed(2)}
Target 2: ₹${checklist.riskMetrics.target2.toFixed(2)}
Shares: ${checklist.riskMetrics.shares}
Max Risk: ₹${checklist.riskMetrics.maxLossInRupees.toFixed(0)}
Max Profit T1: ₹${checklist.riskMetrics.maxProfitT1.toFixed(0)} (R:R ${checklist.riskMetrics.riskRewardT1}:1)
Max Profit T2: ₹${checklist.riskMetrics.maxProfitT2.toFixed(0)} (R:R ${checklist.riskMetrics.riskRewardT2}:1)

${['preEntry', 'entry', 'postEntry'].map((phase) => {
  const phaseData = checklist.phases[phase];
  const phaseTitle = phase === 'preEntry' ? 'PRE-ENTRY' : phase === 'entry' ? 'ENTRY' : 'POST-ENTRY';
  return `═══════════════════════════════════════════════════════
${phaseTitle}
═══════════════════════════════════════════════════════
${phaseData.map((item) => `☐ ${item.item}${item.description ? `\n  → ${item.description}` : ''}`).join('\n\n')}`;
}).join('\n\n')}

═══════════════════════════════════════════════════════
QUICK REFERENCE
═══════════════════════════════════════════════════════
Entry Strategy: Place limit order at entry price
Risk Management: SL at market, T1 and T2 at limit
Profit Taking: Book 50% at T1, trail SL to entry, let T2 run
Max Hold: 15 days (exit by 15:30 if no target/SL hit)
Earnings: Check calendar before entering. Exit pre-earnings.`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const calculateProgress = () => {
    return Math.round((checkedItems.size / checklist.summary.totalItems) * 100);
  };

  return (
    <Card title="✅ Execution Checklist">
      <div className="space-y-4">
        {/* Header with copy button */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">{symbol} Trade Execution Plan</h3>
            <p className="text-xs text-slate-500 mt-1">
              {checklist.summary.totalItems} items across {3} phases
            </p>
          </div>
          <button
            onClick={copyToClipboard}
            className={`px-3 py-2 rounded text-sm font-medium transition-all ${
              copied
                ? 'bg-bull text-white'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            {copied ? '✓ Copied!' : '📋 Copy Checklist'}
          </button>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-500">Progress</span>
            <span className="text-xs font-mono text-accent">{calculateProgress()}%</span>
          </div>
          <div className="w-full bg-slate-700/50 rounded h-2">
            <div
              className="h-2 rounded bg-gradient-to-r from-accent to-bull transition-all"
              style={{ width: `${calculateProgress()}%` }}
            />
          </div>
        </div>

        {/* Risk Metrics Summary */}
        <div className="bg-slate-800/50 rounded p-3 border border-slate-700/50">
          <p className="text-xs text-slate-500 uppercase mb-2">Risk Metrics</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-slate-500">Entry</p>
              <p className="font-mono font-bold text-accent">₹{checklist.riskMetrics.entry.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500">Stop Loss</p>
              <p className="font-mono font-bold text-bear">₹{checklist.riskMetrics.stopLoss.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500">Max Risk</p>
              <p className="font-mono font-bold text-bear">₹{checklist.riskMetrics.maxLossInRupees.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-slate-500">Target 1</p>
              <p className="font-mono font-bold text-bull">₹{checklist.riskMetrics.target1.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500">Target 2</p>
              <p className="font-mono font-bold text-bull">₹{checklist.riskMetrics.target2.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500">Shares</p>
              <p className="font-mono font-bold text-slate-200">{checklist.riskMetrics.shares}</p>
            </div>
          </div>
        </div>

        {/* Checklist Phases */}
        {['preEntry', 'entry', 'postEntry'].map((phaseKey) => {
          const phaseData = checklist.phases[phaseKey];
          const phaseTitle = phaseKey === 'preEntry' ? '🔍 PRE-ENTRY' : phaseKey === 'entry' ? '🎯 ENTRY' : '📊 POST-ENTRY';
          const phaseColor =
            phaseKey === 'preEntry' ? 'border-accent' : phaseKey === 'entry' ? 'border-bull' : 'border-wait';

          return (
            <div key={phaseKey} className={`border-l-4 pl-4 py-2 ${phaseColor}`}>
              <h4 className="text-sm font-bold text-slate-300 mb-3">{phaseTitle}</h4>
              <div className="space-y-2">
                {phaseData.map((item) => (
                  <label key={item.id} className="flex items-start gap-3 p-2 rounded hover:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checkedItems.has(item.id)}
                      onChange={() => toggleCheck(item.id)}
                      className="mt-1 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${checkedItems.has(item.id) ? 'line-through text-slate-500' : 'text-slate-300'}`}>
                        {item.item}
                      </p>
                      {item.description && (
                        <p className="text-xs text-slate-500 mt-1">→ {item.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        {/* Quick Reference */}
        <div className="bg-slate-800/30 rounded p-3 border border-slate-700/50">
          <p className="text-xs text-slate-500 uppercase mb-2">⚡ Quick Reference</p>
          <div className="space-y-1 text-xs text-slate-400">
            <p>📝 Entry: Limit order at ₹{checklist.riskMetrics.entry.toFixed(2)}</p>
            <p>🛑 Risk: SL at market, T1/T2 at limit</p>
            <p>💰 Profit: 50% at T1, trail SL to entry, let T2 run</p>
            <p>⏱️ Max Hold: 15 days (exit 15:30 if no fill)</p>
            <p>📅 Earnings: Check calendar. Exit pre-earnings.</p>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-slate-800/30 rounded p-2 text-center">
            <p className="text-slate-500 mb-1">Pre-Entry</p>
            <p className="font-bold text-accent">{checklist.summary.preEntryCount} items</p>
          </div>
          <div className="bg-slate-800/30 rounded p-2 text-center">
            <p className="text-slate-500 mb-1">Entry</p>
            <p className="font-bold text-bull">{checklist.summary.entryCount} items</p>
          </div>
          <div className="bg-slate-800/30 rounded p-2 text-center">
            <p className="text-slate-500 mb-1">Post-Entry</p>
            <p className="font-bold text-wait">{checklist.summary.postEntryCount} items</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AlertsSection({ alerts, symbol }) {
  const [activeTab, setActiveTab] = React.useState('price');
  const [copiedTemplate, setCopiedTemplate] = React.useState(null);

  if (!alerts) {
    return (
      <Card title="🔔 Alerts & Notifications">
        <div className="text-sm text-slate-400">Alerts configuration unavailable</div>
      </Card>
    );
  }

  const copyToClipboard = async (text, templateName) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTemplate(templateName);
      setTimeout(() => setCopiedTemplate(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  return (
    <Card title="🔔 Alerts & Notifications">
      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-4 gap-2 bg-slate-800/30 rounded p-3">
          <div className="text-center">
            <p className="text-xs text-slate-500">Total Alerts</p>
            <p className="text-lg font-bold text-accent">{alerts.summary.totalAlerts}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Price Alerts</p>
            <p className="text-lg font-bold text-bull">{alerts.summary.priceAlertsCount}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Time Alerts</p>
            <p className="text-lg font-bold text-wait">{alerts.summary.timeAlertsCount}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Events</p>
            <p className="text-lg font-bold text-slate-300">{alerts.summary.eventAlertsCount}</p>
          </div>
        </div>

        {/* Quick Setup */}
        <div className="bg-accent/10 border border-accent/30 rounded p-3">
          <p className="text-sm font-semibold text-accent mb-2">⚡ Quick Setup (15 mins)</p>
          <div className="space-y-2">
            {alerts.setup.quickSetup.map((step) => (
              <div key={step.step} className="text-xs">
                <div className="flex justify-between items-center">
                  <p className="font-semibold text-slate-300">
                    {step.step}. {step.title}
                  </p>
                  <span className="text-slate-500">{step.timeEstimate}</span>
                </div>
                <p className="text-slate-500 mt-1">{step.action}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-slate-700/50">
          {[
            { id: 'price', label: '📍 Price Alerts', color: 'text-bull' },
            { id: 'time', label: '⏰ Time Alerts', color: 'text-wait' },
            { id: 'templates', label: '📋 Templates', color: 'text-accent' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? `${tab.color} border-b-2 border-current`
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Price Alerts Tab */}
        {activeTab === 'price' && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {alerts.priceAlerts.map((alert) => {
              const priorityColor = {
                CRITICAL: '#8b0000',
                HIGH: '#ef4444',
                MEDIUM: '#eab308',
              }[alert.priority];
              return (
                <div
                  key={alert.id}
                  className="border-l-4 pl-3 py-2"
                  style={{ borderLeftColor: priorityColor }}
                >
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-semibold text-slate-300">{alert.type}</p>
                    <span
                      className="px-2 py-1 rounded text-xs font-bold text-white"
                      style={{ backgroundColor: priorityColor }}
                    >
                      {alert.priority}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-1">{alert.condition}</p>
                  <p className="text-xs text-slate-400">{alert.description}</p>
                  <p className="text-xs text-slate-600 mt-1">👉 {alert.action}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Time Alerts Tab */}
        {activeTab === 'time' && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {alerts.timeAlerts.map((alert) => (
              <div key={alert.id} className="border-l-4 border-wait pl-3 py-2">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-semibold text-slate-300">{alert.time}</p>
                  <span className="px-2 py-1 rounded text-xs font-bold bg-wait/30 text-wait">
                    {alert.repeat}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-1">{alert.description}</p>
                <p className="text-xs text-slate-600">👉 {alert.action}</p>
              </div>
            ))}
          </div>
        )}

        {/* Alert Templates Tab */}
        {activeTab === 'templates' && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {Object.entries(alerts.alertTemplates).map(([key, template]) => (
              <div key={key} className="bg-slate-800/30 rounded p-3">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-semibold text-slate-300">{template.platform}</p>
                  <button
                    onClick={() => {
                      const text =
                        template.alerts?.map((a) => `${a.name || a.title}: ${a.condition || a.trigger}`).join('\n') ||
                        template.events?.map((e) => `${e.title}: ${e.time}`).join('\n') ||
                        '';
                      copyToClipboard(text, key);
                    }}
                    className={`px-2 py-1 text-xs rounded transition-all ${
                      copiedTemplate === key
                        ? 'bg-bull text-white'
                        : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                    }`}
                  >
                    {copiedTemplate === key ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-2">{template.instructions}</p>
                <div className="space-y-1">
                  {template.alerts?.slice(0, 2).map((alert, i) => (
                    <p key={i} className="text-xs text-slate-400">
                      • {alert.name || alert.trigger}: {alert.condition || alert.message || alert.level}
                    </p>
                  ))}
                  {template.events?.slice(0, 2).map((event, i) => (
                    <p key={i} className="text-xs text-slate-400">
                      • {event.title} ({event.time})
                    </p>
                  ))}
                  {(template.alerts?.length > 2 || template.events?.length > 2) && (
                    <p className="text-xs text-slate-600">+ more...</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Essential Alerts Checklist */}
        <div className="bg-bear/10 border border-bear/30 rounded p-3">
          <p className="text-sm font-semibold text-bear mb-2">✓ Essential Alerts Checklist</p>
          <div className="space-y-1">
            {alerts.setup.essentialAlerts.map((alert, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="rounded" defaultChecked={false} />
                <span className="text-slate-400">
                  {alert.type}: ₹{alert.level.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Total setup time: {alerts.setup.totalSetupTime}</p>
        </div>
      </div>
    </Card>
  );
}

function MonteCarloSection({ monteCarlo }) {
  if (!monteCarlo || !monteCarlo.available) {
    return (
      <Card title="🎲 Monte Carlo Simulation">
        <div className="text-sm text-slate-400">{monteCarlo?.message || 'Simulation unavailable'}</div>
      </Card>
    );
  }

  return (
    <Card title="🎲 Monte Carlo Simulation (1000 paths)">
      <div className="space-y-4">
        {/* Probabilities */}
        <div className="grid grid-cols-4 gap-2 bg-slate-800/30 rounded p-3">
          <div className="text-center">
            <p className="text-xs text-slate-500">P(T1)</p>
            <p className="text-lg font-bold text-bull">{monteCarlo.probabilities.t1}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">P(T2)</p>
            <p className="text-lg font-bold text-bull">{monteCarlo.probabilities.t2}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">P(SL)</p>
            <p className="text-lg font-bold text-bear">{monteCarlo.probabilities.sl}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">P(Manual)</p>
            <p className="text-lg font-bold text-wait">{monteCarlo.probabilities.manual}%</p>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500">Avg Realized R</p>
            <p className="text-lg font-mono font-bold text-accent">{monteCarlo.statistics.realizedR.avg}R</p>
            <p className="text-xs text-slate-600">Range: {monteCarlo.statistics.realizedR.min}R to {monteCarlo.statistics.realizedR.max}R</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500">Avg Hold Days</p>
            <p className="text-lg font-mono font-bold text-accent">{monteCarlo.statistics.holdDuration.avg}d</p>
            <p className="text-xs text-slate-600">95% CI: {monteCarlo.confidenceIntervals.ci95_low}R to {monteCarlo.confidenceIntervals.ci95_high}R</p>
          </div>
        </div>

        {/* Hold Distribution */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Hold Duration Distribution</p>
          <div className="space-y-1">
            {Object.entries(monteCarlo.holdDistribution).map(([range, data]) => (
              <div key={range} className="flex justify-between items-center bg-slate-800/30 rounded px-3 py-2 text-xs">
                <span className="text-slate-400">{range}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-2 bg-slate-700 rounded">
                    <div className="h-2 bg-accent rounded" style={{ width: `${data.percent}%` }} />
                  </div>
                  <span className="font-mono text-slate-300" style={{ minWidth: '45px' }}>{data.percent}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendation */}
        <div className={`rounded p-3 text-sm border ${monteCarlo.recommendation.confidence === 'VERY_HIGH' ? 'bg-bull/10 border-bull/30' : monteCarlo.recommendation.confidence === 'HIGH' ? 'bg-accent/10 border-accent/30' : 'bg-wait/10 border-wait/30'}`}>
          <p className="font-semibold text-slate-300 mb-1">{monteCarlo.recommendation.recommendation}</p>
          <p className="text-xs text-slate-400">{monteCarlo.recommendation.reasoning}</p>
        </div>
      </div>
    </Card>
  );
}

function TradeJournalSection({ journal }) {
  if (!journal || !journal.available) {
    return (
      <Card title="📔 Trade Journal">
        <div className="text-sm text-slate-400">{journal?.message || 'Journal unavailable'}</div>
      </Card>
    );
  }

  return (
    <Card title="📔 Trade Journal Search">
      <div className="space-y-4">
        {/* Summary */}
        <div className="bg-accent/10 border border-accent/30 rounded p-3">
          <p className="font-semibold text-accent mb-1">📊 {journal.summary.verdict}</p>
          <p className="text-xs text-slate-400">{journal.summary.recommendation}</p>
          <p className="text-xs text-slate-600 mt-1">Similar: {journal.summary.similarTradesFound} | Closed: {journal.summary.closedTradesAnalyzed}</p>
        </div>

        {/* Outcome Comparison */}
        {journal.outcomeComparison.sampleSize > 0 && (
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-2">Past Performance</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-slate-500">Planned R:R</p>
                <p className="font-mono font-bold text-slate-300">{journal.outcomeComparison.plannedAvgRR}:1</p>
              </div>
              <div>
                <p className="text-slate-500">Realized R:R</p>
                <p className="font-mono font-bold text-accent">{journal.outcomeComparison.realizedAvgRR}:1</p>
              </div>
              <div>
                <p className="text-slate-500">Win Rate</p>
                <p className="font-mono font-bold text-bull">{journal.outcomeComparison.winRate}%</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">{journal.outcomeComparison.insight}</p>
          </div>
        )}

        {/* Lessons Learned */}
        {journal.lessons && journal.lessons.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase mb-2">💡 Lessons Learned</p>
            <div className="space-y-2">
              {journal.lessons.slice(0, 3).map((lesson, i) => (
                <div key={i} className="bg-slate-800/30 rounded p-2 text-xs">
                  <p className="font-semibold text-slate-300">{lesson.category}</p>
                  <p className="text-slate-400 mt-1">{lesson.lesson}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function SectorMomentumSection({ sector }) {
  if (!sector || !sector.available) {
    return (
      <Card title="📊 Sector Momentum">
        <div className="text-sm text-slate-400">{sector?.message || 'Data unavailable'}</div>
      </Card>
    );
  }

  const momentumColor = sector.sectorMomentum.score > 60 ? '#22c55e' : sector.sectorMomentum.score >= 40 ? '#eab308' : '#ef4444';
  const lead = /LEADER|LEADING/.test(sector.ranking.position);
  const lag = /LAGG/.test(sector.ranking.position);
  const rankingColor = lead ? '#22c55e' : lag ? '#ef4444' : '#eab308';
  const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

  return (
    <Card title="📈 Sector Momentum & Relative Strength">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Sector Momentum (peer-derived) */}
          <div className="bg-slate-800/30 rounded p-3 border-l-4" style={{ borderLeftColor: momentumColor }}>
            <p className="text-xs text-slate-500">Sector: {sector.sector}</p>
            <p className="text-2xl font-bold font-mono mt-1" style={{ color: momentumColor }}>
              {sector.sectorMomentum.score}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {sector.sectorMomentum.strength} · {sector.sectorMomentum.trend} · peers {pct(sector.sectorMomentum.avgPeerReturn20d)} (20d)
            </p>
          </div>

          {/* Relative Strength Ranking (real 20-day return) */}
          <div className="bg-slate-800/30 rounded p-3 border-l-4" style={{ borderLeftColor: rankingColor }}>
            <p className="text-xs text-slate-500">Your Rank · RS {pct(sector.ranking.relativeStrength)}</p>
            <p className="text-2xl font-bold font-mono mt-1" style={{ color: rankingColor }}>
              {sector.ranking.ranking}
            </p>
            <p className="text-xs text-slate-400 mt-1">{sector.ranking.percentile}%ile · {sector.ranking.position}</p>
          </div>
        </div>

        {/* Peer 20-day relative strength */}
        <div className="bg-slate-800/30 rounded p-3">
          <p className="text-xs text-slate-500 uppercase mb-2">Peer 20-day return</p>
          <div className="space-y-1">
            {sector.peers.slice(0, 5).map((peer) => (
              <div key={peer.symbol} className="flex justify-between items-center text-xs">
                <span className="font-mono text-slate-300">{peer.symbol}</span>
                <span className={peer.relativeStrength >= 0 ? 'text-bull' : 'text-bear'}>{pct(peer.relativeStrength)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actionable */}
        <div className={`rounded p-3 text-xs ${sector.actionable.riskLevel === 'LOW' ? 'bg-bull/10 border border-bull/30' : sector.actionable.riskLevel === 'HIGH' ? 'bg-bear/10 border border-bear/30' : 'bg-wait/10 border border-wait/30'}`}>
          <p className="font-semibold text-slate-300 mb-1">{sector.actionable.recommendation}</p>
        </div>

        {sector.sectorMomentum.basis && (
          <p className="text-[10px] text-slate-600 italic">{sector.sectorMomentum.basis}</p>
        )}
      </div>
    </Card>
  );
}

function VolatilitySurfaceSection({ vol }) {
  if (!vol || !vol.available) {
    return (
      <Card title="⚡ Volatility Surface">
        <div className="text-sm text-slate-400">{vol?.message || 'Data unavailable'}</div>
      </Card>
    );
  }

  return (
    <Card title="⚡ Volatility Surface & IV Crush">
      <div className="space-y-4">
        {/* Volatility Metrics */}
        <div className="grid grid-cols-3 gap-2 bg-slate-800/30 rounded p-3">
          <div className="text-center">
            <p className="text-xs text-slate-500">Realized Vol</p>
            <p className="text-lg font-mono font-bold text-slate-200">{vol.volatilityAnalysis.realizedVol}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Implied Vol</p>
            <p className="text-lg font-mono font-bold text-accent">{vol.volatilityAnalysis.impliedVol}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">IV Rank</p>
            <p className="text-lg font-mono font-bold text-bull">{vol.volatilityAnalysis.ivPercentile}%ile</p>
          </div>
        </div>

        {/* IV Crush */}
        <div className="bg-bear/10 border border-bear/30 rounded p-3">
          <p className="text-xs font-semibold text-bear mb-1">🔴 IV Crush Expected</p>
          <div className="text-xs text-slate-400 space-y-1">
            <p>Post-earnings IV: {vol.ivCrush.postEarningsIV}% ({vol.ivCrush.crushPercentage}% crush)</p>
            <p>Expectation: <span className="font-semibold">{vol.ivCrush.crushExpectation}</span></p>
          </div>
        </div>

        {/* Key Level Pricing */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Option Pricing at Key Levels</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {vol.keyLevelPricing.slice(0, 4).map((level) => (
              <div key={level.level} className="flex justify-between items-center bg-slate-800/30 rounded px-2 py-1 text-xs">
                <span className="text-slate-400">{level.level}</span>
                <span className="font-mono text-slate-300">₹{level.price}</span>
                <span className={level.liquidityAssessment === 'HIGH' ? 'text-bull' : 'text-slate-500'}>{level.liquidityAssessment}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Summary Insight */}
        <div className="bg-slate-800/30 rounded p-3 text-xs">
          <p className="text-slate-400 mb-1"><strong>Entry Recommendation:</strong></p>
          <p className="text-slate-300">{vol.summary.entryRecommendation}</p>
        </div>
      </div>
    </Card>
  );
}

function RiskHeatMapSection({ heatMap }) {
  if (!heatMap || !heatMap.available) {
    return (
      <Card title="🔥 Risk Heat Map">
        <div className="text-sm text-slate-400">{heatMap?.message || 'Risk data unavailable'}</div>
      </Card>
    );
  }

  const riskColors = {
    CRITICAL: '#8b0000',
    HIGH: '#ef4444',
    MEDIUM: '#eab308',
    MODERATE: '#84cc16',
    LOW: '#22c55e',
  };

  return (
    <Card title="🔥 Risk Heat Map">
      <div className="space-y-4">
        {/* Overall Heat Level */}
        <div className="bg-slate-800/50 rounded-lg p-4 border-l-4" style={{ borderLeftColor: heatMap.heatColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Overall Risk Level</span>
            <span
              className="px-3 py-1 rounded text-sm font-bold text-white"
              style={{ backgroundColor: heatMap.heatColor }}
            >
              {heatMap.heatLevel}
            </span>
          </div>
          <div className="mb-3">
            <div className="w-full bg-slate-700/50 rounded h-3">
              <div
                className="h-3 rounded bg-gradient-to-r from-bull to-bear transition-all"
                style={{ width: `${heatMap.overallScore}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">Risk Score: {heatMap.overallScore}/100</p>
          </div>
          <p className="text-sm text-slate-300">{heatMap.recommendation}</p>
        </div>

        {/* Risk Factors Grid */}
        <div className="grid grid-cols-2 gap-2">
          {heatMap.factors.map((factor) => (
            <div key={factor.name} className="bg-slate-800/30 rounded p-3">
              <div className="flex justify-between items-start mb-1">
                <p className="text-xs font-semibold text-slate-300">{factor.name}</p>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: factor.score > 60 ? '#ef4444' : factor.score > 40 ? '#eab308' : '#22c55e',
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 mb-1">{factor.label}</p>
              <p className="text-xs text-slate-400 line-clamp-2">{factor.description}</p>
            </div>
          ))}
        </div>

        {/* Critical Risks */}
        {heatMap.criticalRisks && heatMap.criticalRisks.length > 0 && (
          <div className="bg-bear/10 border border-bear/30 rounded p-3">
            <p className="text-sm font-semibold text-bear mb-2">⚠️ Critical Risks</p>
            <ul className="space-y-1">
              {heatMap.criticalRisks.map((risk, i) => (
                <li key={i} className="text-xs text-slate-400">
                  • {risk.factor}: {risk.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function PriceLevelHeatMapSection({ priceMap }) {
  if (!priceMap) {
    return (
      <Card title="📊 Price Level Heat Map">
        <div className="text-sm text-slate-400">Price level data unavailable</div>
      </Card>
    );
  }

  return (
    <Card title="📊 Price Level Heat Map">
      <div className="space-y-4">
        {/* Price Levels */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Key Price Levels & Intensity</p>
          <div className="space-y-2">
            {priceMap.levels.map((level) => (
              <div key={level.label} className="flex items-center gap-3 bg-slate-800/30 rounded px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <p className="text-sm font-semibold text-slate-300">{level.label}</p>
                    <p className="text-xs font-mono text-slate-400">₹{level.price.toFixed(2)}</p>
                  </div>
                  <p className="text-xs text-slate-500">{level.description}</p>
                </div>
                <div className="w-12 h-6 rounded bg-slate-700/50 overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${level.strength}%`,
                      backgroundColor:
                        level.strength > 75 ? '#ef4444' : level.strength > 50 ? '#eab308' : '#22c55e',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Volume Zones */}
        {priceMap.volumeZones && (
          <div>
            <p className="text-xs text-slate-500 uppercase mb-2">Volume Zones <span className="text-slate-600 normal-case">(heuristic)</span></p>
            <div className="space-y-1">
              {priceMap.volumeZones.map((zone) => (
                <div key={zone.zone} className="text-xs bg-slate-800/30 rounded px-2 py-1">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-300">{zone.zone}</span>
                    <span className={`font-semibold ${zone.volumeIntensity === 'VERY_HIGH' ? 'text-bear' : zone.volumeIntensity === 'HIGH' ? 'text-wait' : 'text-slate-400'}`}>
                      {zone.volumeIntensity}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-1">{zone.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interpretation */}
        {priceMap.interpretation && (
          <div className="bg-accent/10 border border-accent/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-2">📌 Observations</p>
            <ul className="space-y-1">
              {priceMap.interpretation.map((finding, i) => (
                <li key={i} className="text-xs text-slate-400">
                  • {finding}
                </li>
              ))}
            </ul>
          </div>
        )}

        {priceMap.basis && <p className="text-[10px] text-slate-600 italic">{priceMap.basis}</p>}
      </div>
    </Card>
  );
}

function PeerComparisonSection({ peers, symbol }) {
  if (!peers || !peers.available) {
    return (
      <Card title="👥 Peer Comparison">
        <div className="text-sm text-slate-400">{peers?.message || 'Peer data unavailable'}</div>
      </Card>
    );
  }

  const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
  const pctColor = (v) => (v == null ? 'text-slate-400' : v >= 0 ? 'text-bull' : 'text-bear');

  return (
    <Card title="👥 Peer Comparison">
      <div className="space-y-4">
        {/* Your Ranking (real 20-day relative performance) */}
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Sector RS Ranking</span>
            <span className="text-2xl font-bold text-accent">
              {peers.ranking.percentile == null ? '—' : `${peers.ranking.percentile}%ile`}
            </span>
          </div>
          <p className="text-sm text-slate-300 mb-2">{peers.recommendation}</p>
          <p className="text-xs text-slate-500">
            Your 20-day return: <span className={pctColor(peers.your?.return20d)}>{pct(peers.your?.return20d)}</span>
            {peers.your?.riskReward != null ? ` · setup R:R ${peers.your.riskReward}:1` : ''}
          </p>
        </div>

        {/* Peer rows — real price, day change, 20-day return, latest signal */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Sector: {peers.sector} · {peers.peerCount} peers</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {peers.peers.map((peer) => (
              <div key={peer.symbol} className="bg-slate-800/30 rounded p-3">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200">{peer.symbol}</span>
                    {peer.verdict && (
                      <span className={`text-[10px] font-semibold badge-${peer.verdict.toLowerCase()}`}>{peer.verdict}</span>
                    )}
                  </div>
                  <span className="font-mono text-sm text-slate-200">
                    {peer.price != null ? `₹${Number(peer.price).toLocaleString('en-IN')}` : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500">Day</p>
                    <p className={`font-mono ${pctColor(peer.changePct)}`}>{pct(peer.changePct)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">20-day</p>
                    <p className={`font-mono ${pctColor(peer.return20d)}`}>{pct(peer.return20d)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Setup R:R</p>
                    <p className="font-mono text-accent">{peer.riskReward != null ? `${peer.riskReward}:1` : '—'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {peers.note && <p className="text-[10px] text-slate-600 italic">{peers.note}</p>}
      </div>
    </Card>
  );
}

function EarningsSection({ earnings }) {
  if (!earnings || !earnings.available) {
    return (
      <Card title="📈 Earnings Impact Model">
        <div className="text-sm text-slate-400">
          {earnings?.message || 'Earnings data unavailable'}
        </div>
      </Card>
    );
  }

  const riskColors = {
    CRITICAL: '#8b0000',
    HIGH: '#ef4444',
    MEDIUM: '#eab308',
    LOW: '#84cc16',
    SAFE: '#22c55e',
  };

  const riskColor = riskColors[earnings.riskLevel];
  const adviceColor = earnings.tradingAdvice === 'AVOID' ? '#ef4444' : earnings.tradingAdvice === 'CAUTION' ? '#eab308' : '#22c55e';

  return (
    <Card title="📈 Earnings Impact Model">
      <div className="space-y-4">
        {/* Earnings Date & Risk */}
        <div className="bg-slate-800/50 rounded-lg p-4 border-l-4" style={{ borderLeftColor: riskColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Earnings Announcement</span>
            <span className="text-sm font-mono text-slate-400">{earnings.earnings.date}</span>
          </div>
          <div className="mb-3">
            <p className="text-lg font-bold text-accent">{earnings.earnings.daysAway} days away</p>
            <p className="text-xs text-slate-500 mt-1">{earnings.earnings.timeOfDay}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="px-3 py-1 rounded text-xs font-bold text-white"
              style={{ backgroundColor: riskColor }}
            >
              {earnings.riskLevel}
            </span>
            <span
              className="px-3 py-1 rounded text-xs font-bold text-white"
              style={{ backgroundColor: adviceColor }}
            >
              {earnings.tradingAdvice}
            </span>
          </div>
        </div>

        {/* Trading Recommendation */}
        <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
          <p className="text-sm font-semibold text-slate-300 mb-2">Trading Strategy</p>
          <p className="text-sm text-slate-200">{earnings.recommendation.strategy}</p>
        </div>

        {/* Historical Earnings Moves */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Historical Earnings Move Range</p>
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-slate-800/30 rounded p-3">
              <p className="text-xs text-slate-500">Avg Up</p>
              <p className="text-lg font-mono font-bold text-bull">+{earnings.historicalMoves.avgUp.toFixed(1)}%</p>
            </div>
            <div className="bg-slate-800/30 rounded p-3">
              <p className="text-xs text-slate-500">Avg Down</p>
              <p className="text-lg font-mono font-bold text-bear">{earnings.historicalMoves.avgDown.toFixed(1)}%</p>
            </div>
            <div className="bg-slate-800/30 rounded p-3">
              <p className="text-xs text-slate-500">Max Move</p>
              <p className="text-lg font-mono font-bold text-accent">±{earnings.historicalMoves.maxMove.toFixed(1)}%</p>
            </div>
            <div className="bg-slate-800/30 rounded p-3">
              <p className="text-xs text-slate-500">Sample Size</p>
              <p className="text-lg font-mono font-bold text-slate-200">{earnings.historicalMoves.sampleSize}</p>
            </div>
          </div>
        </div>

        {/* IV Crush Impact */}
        <div className="bg-slate-800/50 rounded p-3 border border-slate-700/50">
          <p className="text-sm font-semibold text-slate-300 mb-2">Implied Volatility (IV) Crush</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Current ATR</span>
              <span className="font-mono font-bold">{earnings.volatility.currentAtr.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Pre-Earnings IV Est.</span>
              <span className="font-mono font-bold text-wait">{earnings.volatility.preEarningsIV.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Post-Earnings IV Est.</span>
              <span className="font-mono font-bold text-slate-200">{earnings.volatility.postEarningsIV.toFixed(2)}%</span>
            </div>
            <div className="border-t border-slate-700/50 pt-2 flex justify-between items-center text-sm font-semibold">
              <span className="text-slate-300">IV Crush</span>
              <span className="text-bear">{earnings.volatility.crushPct.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Volatility typically drops post-earnings as uncertainty resolves. Targets will be harder to reach.
          </p>
        </div>

        {/* Adjusted Targets */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Adjusted Targets (IV Crush Impact)</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center bg-slate-800/30 rounded px-3 py-2">
              <div>
                <p className="text-sm text-slate-400">Target 1</p>
                <p className="text-xs text-slate-500 mt-1">Original → Adjusted</p>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-slate-200">
                  ₹{earnings.adjustedTargets.originalT1.toFixed(2)} → ₹{earnings.adjustedTargets.adjustedT1.toFixed(2)}
                </p>
                <p className={`text-xs font-mono ${earnings.adjustedTargets.t1Reduction < 0 ? 'text-bear' : 'text-bull'}`}>
                  {earnings.adjustedTargets.t1Reduction > 0 ? '+' : ''}{earnings.adjustedTargets.t1Reduction.toFixed(2)}%
                </p>
              </div>
            </div>
            <div className="flex justify-between items-center bg-slate-800/30 rounded px-3 py-2">
              <div>
                <p className="text-sm text-slate-400">Target 2</p>
                <p className="text-xs text-slate-500 mt-1">Original → Adjusted</p>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-slate-200">
                  ₹{earnings.adjustedTargets.originalT2.toFixed(2)} → ₹{earnings.adjustedTargets.adjustedT2.toFixed(2)}
                </p>
                <p className={`text-xs font-mono ${earnings.adjustedTargets.t2Reduction < 0 ? 'text-bear' : 'text-bull'}`}>
                  {earnings.adjustedTargets.t2Reduction > 0 ? '+' : ''}{earnings.adjustedTargets.t2Reduction.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Gap Risk */}
        <div className="bg-bear/10 border border-bear/30 rounded p-3">
          <p className="text-sm font-semibold text-slate-300 mb-2">Gap Risk (Earnings Announcement)</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Worst Case Down</span>
              <span className="font-mono font-bold text-bear">{earnings.gapRisk.worstCaseDown.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Worst Case Up</span>
              <span className="font-mono font-bold text-bull">+{earnings.gapRisk.worstCaseUp.toFixed(2)}%</span>
            </div>
            <div className="border-t border-slate-700/50 pt-2 flex justify-between font-semibold">
              <span className="text-slate-300">Safe SL Below</span>
              <span className="font-mono text-bear">₹{earnings.gapRisk.safeSL.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Stock can gap 5-7%+ on earnings. Plan wide SL or avoid.</p>
        </div>

        {/* Recommendation Notes */}
        {earnings.recommendation.notes && earnings.recommendation.notes.length > 0 && (
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-2">Key Points</p>
            <ul className="space-y-1">
              {earnings.recommendation.notes.map((note, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-slate-600 mt-1">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Wait Until */}
        {earnings.recommendation.waitUntil && earnings.tradingAdvice === 'AVOID' && (
          <div className="bg-bear/10 border border-bear/30 rounded p-3">
            <p className="text-sm font-semibold text-bear mb-1">Recommended Wait Until</p>
            <p className="text-sm font-mono text-slate-200">{earnings.recommendation.waitUntil}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function PortfolioStressSection({ stress }) {
  if (!stress || !stress.available) {
    return (
      <Card title="💼 Portfolio Stress Test">
        <div className="text-sm text-slate-400">
          {stress?.message || 'Portfolio data unavailable'}
        </div>
      </Card>
    );
  }

  const capital = stress.capital;
  const assessment = stress.assessment;
  const scenarios = stress.stressScenarios;

  const riskColors = {
    LOW: '#22c55e',
    MEDIUM: '#eab308',
    HIGH: '#ef4444',
    CRITICAL: '#8b0000',
  };

  const riskColor = riskColors[assessment.riskLevel];

  return (
    <Card title="💼 Portfolio Stress Test">
      <div className="space-y-4">
        {/* Risk Level Assessment */}
        <div className="bg-slate-800/50 rounded-lg p-4 border-l-4" style={{ borderLeftColor: riskColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Portfolio Risk Level</span>
            <span
              className="px-3 py-1 rounded text-xs font-bold text-white"
              style={{ backgroundColor: riskColor }}
            >
              {assessment.riskLevel}
            </span>
          </div>
          <div className="mb-3">
            <div className="w-full bg-slate-700/50 rounded h-2">
              <div
                className="h-2 rounded bg-gradient-to-r from-bear to-bull"
                style={{ width: `${assessment.safetyScore}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">Safety Score: {assessment.safetyScore}/100</p>
          </div>
          <p className="text-sm text-slate-300">{assessment.recommendation}</p>
        </div>

        {/* Capital Status */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Total Capital</p>
            <p className="text-lg font-mono font-bold text-slate-200">
              ₹{(capital.total / 100_000).toFixed(1)}L
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Deployed</p>
            <p className={`text-lg font-mono font-bold ${parseFloat(capital.percentDeployed) > 70 ? 'text-wait' : 'text-slate-200'}`}>
              {capital.percentDeployed}%
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Available</p>
            <p className={`text-lg font-mono font-bold ${stress.newTrade.canAdd ? 'text-bull' : 'text-bear'}`}>
              ₹{(capital.available / 100_000).toFixed(1)}L
            </p>
          </div>
        </div>

        {/* Can Afford 2 SLs? */}
        <div
          className={`rounded-lg p-3 border-l-4 ${
            assessment.canAfford2SLs
              ? 'bg-bull/10 border-bull/50'
              : 'bg-bear/10 border-bear/50'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={assessment.canAfford2SLs ? 'text-bull text-lg' : 'text-bear text-lg'}>
              {assessment.canAfford2SLs ? '✓' : '✕'}
            </span>
            <span className="font-semibold text-slate-200">Can afford 2 SL hits simultaneously?</span>
            <span className={`font-bold ${assessment.canAfford2SLs ? 'text-bull' : 'text-bear'}`}>
              {assessment.canAfford2SLs ? 'YES' : 'NO'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {assessment.canAfford2SLs
              ? 'Portfolio has sufficient capital if 2 trades stop out at SL'
              : 'Portfolio lacks capital to handle 2 simultaneous SL hits'}
          </p>
        </div>

        {/* Max Loss Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Max Loss Ratio</p>
            <p className="text-lg font-mono font-bold text-bear">{assessment.maxLossRatio}%</p>
            <p className="text-xs text-slate-500 mt-1">of total capital</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Worst Case Stress</p>
            <p className="text-lg font-mono font-bold text-slate-200">
              -{scenarios[scenarios.length - 1].drawdownPct}%
            </p>
            <p className="text-xs text-slate-500 mt-1">at -15% market drop</p>
          </div>
        </div>

        {/* Open Trades Summary */}
        {stress.openTrades.count > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase mb-2">
              Open Trades ({stress.openTrades.count})
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {stress.openTrades.trades.map((trade, i) => (
                <div key={i} className="flex justify-between items-center bg-slate-800/30 rounded px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200">{trade.symbol}</span>
                    <span className={`text-slate-400 ${trade.unrealizedPnl > 0 ? 'text-bull' : 'text-bear'}`}>
                      {trade.unrealizedPnl > 0 ? '+' : ''}₹{trade.unrealizedPnl.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">
                      {trade.distanceToSLPct > 0 ? '+' : ''}{trade.distanceToSLPct.toFixed(1)}% to SL
                    </span>
                    <span className={`font-mono font-bold ${trade.maxLoss > 0 ? 'text-bear' : 'text-slate-200'}`}>
                      Max -₹{Math.abs(trade.maxLoss).toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stress Scenario Table */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Stress Scenarios</p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {scenarios.map((scenario, i) => (
              <div
                key={i}
                className={`flex justify-between items-center px-3 py-2 rounded text-xs ${
                  scenario.canAfford
                    ? 'bg-slate-800/20 border border-slate-700/50'
                    : 'bg-bear/10 border border-bear/30'
                }`}
              >
                <div>
                  <p className="font-semibold text-slate-300">{scenario.scenario}</p>
                  <p className="text-slate-500">
                    {scenario.tradesStoppedOut ?? 0} trade{scenario.tradesStoppedOut !== 1 ? 's' : ''} stopped |
                    Loss: ₹{(scenario.totalLoss ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-slate-200">
                    ₹{((scenario.remainingCapital ?? 0) / 100_000).toFixed(1)}L
                  </p>
                  <p className={`text-xs ${scenario.canAfford ? 'text-bull' : 'text-bear'}`}>
                    {scenario.canAfford ? '✓ Affordable' : '✕ Risky'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LiquiditySection({ liquidity }) {
  if (!liquidity || !liquidity.available) {
    return (
      <Card title="💧 Liquidity & Slippage">
        <div className="text-sm text-slate-400">
          {liquidity?.message || 'Liquidity data unavailable'}
        </div>
      </Card>
    );
  }

  const overall = liquidity.overall;
  const vol = liquidity.volume;
  const levels = liquidity.levels;

  const ratingColor = {
    EXCELLENT: '#22c55e',
    GOOD: '#84cc16',
    DECENT: '#eab308',
    POOR: '#ef4444',
  }[overall.rating];

  const badgeType = {
    EXCELLENT: 'bull',
    GOOD: 'bull',
    DECENT: 'accent',
    POOR: 'bear',
  }[overall.rating];

  const levelColor = (liq) => {
    if (liq === 'EXCELLENT') return '#22c55e';
    if (liq === 'GOOD') return '#84cc16';
    if (liq === 'DECENT') return '#eab308';
    return '#ef4444';
  };

  return (
    <Card title="💧 Liquidity & Slippage Analysis">
      <div className="space-y-4">
        {/* Overall Assessment */}
        <div className="bg-slate-800/50 rounded-lg p-4 border-l-4" style={{ borderLeftColor: ratingColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Liquidity Rating</span>
            <Badge text={overall.rating} type={badgeType} />
          </div>
          <div className="mb-3 pt-2">
            <div className="w-full bg-slate-700/50 rounded h-2">
              <div
                className="h-2 rounded bg-gradient-to-r from-bear to-bull"
                style={{ width: `${overall.score}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">Score: {overall.score}/100</p>
          </div>
          <p className="text-sm text-slate-300 mb-2">{overall.recommendation}</p>

          {/* Safe to Enter Badge */}
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${overall.safeToEnter ? 'bg-bull/20 text-bull' : 'bg-bear/20 text-bear'}`}>
            {overall.safeToEnter ? '✓' : '⚠'} {overall.safeToEnter ? 'Safe to Enter' : 'Enter with Caution'}
          </div>
        </div>

        {/* Volume Metrics */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Today Volume</p>
            <p className="text-lg font-mono font-bold text-slate-200">
              {(vol.today / 1_000_000).toFixed(1)}M
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">20d Avg</p>
            <p className="text-lg font-mono font-bold text-slate-200">
              {(vol.avg20d / 1_000_000).toFixed(1)}M
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Ratio</p>
            <p className={`text-lg font-mono font-bold ${vol.ratio > 1 ? 'text-bull' : 'text-slate-300'}`}>
              {vol.ratio.toFixed(2)}x
            </p>
            <p className="text-xs text-slate-500 mt-1">{vol.ratioAssessment}</p>
          </div>
        </div>

        {/* Spread & Volatility */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Bid-Ask Spread</p>
            <p className="text-lg font-mono font-bold text-accent">{liquidity.spread.estimatedPct}%</p>
            <p className="text-xs text-slate-500 mt-1">({liquidity.spread.estimatedBps} bps)</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Volatility (ATR)</p>
            <p className="text-lg font-mono font-bold text-slate-200">{liquidity.volatility.atrPct}%</p>
            <p className="text-xs text-slate-500 mt-1">{liquidity.volatility.assessment}</p>
          </div>
        </div>

        {/* Price Level Liquidity */}
        <div>
          <p className="text-xs text-slate-500 uppercase mb-2">Liquidity at Price Levels</p>
          <div className="space-y-1">
            {['entry', 'stopLoss', 'target1', 'target2'].map((levelKey) => {
              const level = levels[levelKey];
              const color = levelColor(level.liquidity);
              const label = {
                entry: 'Entry',
                stopLoss: 'Stop Loss',
                target1: 'Target 1',
                target2: 'Target 2',
              }[levelKey];
              return (
                <div key={levelKey} className="flex justify-between items-center bg-slate-800/30 rounded px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-mono text-slate-300">{level.price.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{level.distancePct.toFixed(1)}% away</span>
                    <span className="px-2 py-1 rounded text-xs font-semibold" style={{ backgroundColor: color + '20', color }}>
                      {level.liquidity}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Slippage Cost */}
        <div className="bg-slate-800/50 rounded p-3 border border-slate-700/50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-slate-400">Expected Entry Slippage</span>
            <span className={`font-mono font-bold ${liquidity.slippage.isAcceptable ? 'text-bull' : 'text-bear'}`}>
              ₹{liquidity.slippage.estimatedCostAtEntry} ({liquidity.slippage.estimatedCostInR.toFixed(2)}R)
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {liquidity.slippage.isAcceptable ? '✓ Acceptable slippage cost' : '⚠ High slippage — may eat into profit'}
          </p>
        </div>

        {/* Risk Factors */}
        {overall.riskFactors && overall.riskFactors.length > 0 && (
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-2">Liquidity Risk Factors</p>
            <ul className="space-y-1">
              {overall.riskFactors.map((factor, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-slate-600 mt-1">•</span>
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function BacktestSection({ backtest }) {
  if (!backtest || !backtest.available) {
    return (
      <Card title="📊 Historical Backtest (2y)">
        <div className="text-sm text-slate-400">
          {backtest?.message || 'Backtest data unavailable'}
        </div>
      </Card>
    );
  }

  const assessment = backtest.assessment;
  const stats = backtest.stats;
  const interpretation = backtest.interpretation;

  const ratingColor = {
    EXCELLENT: '#22c55e',
    GOOD: '#84cc16',
    DECENT: '#eab308',
    POOR: '#ef4444',
  }[assessment.rating];

  const badgeType = {
    EXCELLENT: 'bull',
    GOOD: 'bull',
    DECENT: 'accent',
    POOR: 'bear',
  }[assessment.rating];

  return (
    <Card title="📊 Historical Backtest (2 Years)">
      <div className="space-y-4">
        {/* Assessment Rating */}
        <div className="bg-slate-800/50 rounded-lg p-4 border-l-4" style={{ borderLeftColor: ratingColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Setup Performance</span>
            <Badge text={assessment.rating} type={badgeType} />
          </div>
          <p className="text-xs text-slate-400 mb-2">
            Confidence: <span className="font-mono text-slate-200">{assessment.confidence}</span>
          </p>
          <p className="text-sm text-slate-300 font-medium">{interpretation.message}</p>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Total Trades</p>
            <p className="text-lg font-mono font-bold text-accent">{stats.totalTrades}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Win Rate</p>
            <p className={`text-lg font-mono font-bold ${stats.winRate >= 55 ? 'text-bull' : 'text-slate-300'}`}>
              {stats.winRate}
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Avg R/Trade</p>
            <p className={`text-lg font-mono font-bold ${stats.avgRealizedRR >= 0 ? 'text-bull' : 'text-bear'}`}>
              {stats.avgRealizedRR}
            </p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">T1 Hit Rate</p>
            <p className="text-lg font-mono font-bold text-accent">{stats.winRateT1}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">T2 Hit Rate</p>
            <p className="text-lg font-mono font-bold text-accent">{stats.winRateT2}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Avg Hold</p>
            <p className="text-lg font-mono font-bold text-slate-200">{stats.avgHoldingDays}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Best Win</p>
            <p className="text-lg font-mono font-bold text-bull">{stats.largestWin}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Worst Loss</p>
            <p className="text-lg font-mono font-bold text-bear">{stats.largestLoss}</p>
          </div>
          <div className="bg-slate-800/30 rounded p-3">
            <p className="text-xs text-slate-500 uppercase mb-1">Max Wins Row</p>
            <p className="text-lg font-mono font-bold text-slate-200">{stats.maxConsecutiveWins}</p>
          </div>
        </div>

        {/* Recommendation */}
        <div className={`rounded-lg p-3 text-sm ${interpretation.actionable ? 'bg-bull/10 border border-bull/30' : 'bg-bear/10 border border-bear/30'}`}>
          <p className={`font-semibold mb-1 ${interpretation.actionable ? 'text-bull' : 'text-bear'}`}>
            {interpretation.actionable ? '✓' : '⚠'} Recommendation
          </p>
          <p className="text-xs text-slate-300">{interpretation.suggestion}</p>
        </div>

        {/* Recent Trades */}
        {backtest.recentTrades && backtest.recentTrades.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase mb-2">Recent Trades</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {backtest.recentTrades.map((trade, i) => (
                <div key={i} className="flex justify-between text-xs bg-slate-800/30 rounded px-2 py-1">
                  <span className="text-slate-400">{new Date(trade.date).toLocaleDateString()}</span>
                  <span className={`font-mono ${trade.result.startsWith('+') ? 'text-bull' : 'text-bear'}`}>
                    {trade.result}
                  </span>
                  <span className="text-slate-500">{trade.exit}</span>
                  <span className="text-slate-600">{trade.hold}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-surface p-6 max-w-[1400px] mx-auto">
      <div className="animate-pulse space-y-6">
        <div className="h-12 w-64 bg-slate-700/50 rounded" />
        <div className="h-8 w-40 bg-slate-700/50 rounded" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-700/50 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({ error, sym }) {
  return (
    <div className="min-h-screen bg-surface p-6 max-w-[1400px] mx-auto">
      <div className="card border-bear/30 bg-bear/10 text-bear">
        Error loading analysis for {sym}: {error}
      </div>
    </div>
  );
}

export default AnalysisReport;
