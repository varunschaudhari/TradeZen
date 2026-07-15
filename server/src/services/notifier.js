/**
 * @file notifier.js
 * @description Telegram + Email alerts with 4-hour in-memory deduplication per alert type.
 *              Never throws — all failures are logged and swallowed so callers stay clean.
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-14
 */

import TelegramBot from 'node-telegram-bot-api';
import nodemailer from 'nodemailer';
import Config from '../models/Config.js';
import User from '../models/User.js';
import { logger } from '../config/logger.js';

// ── Formatters ────────────────────────────────────────────────────────────────
const INR_FMT = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const fmt = (n, d = 2) => (n != null ? Number(n).toFixed(d) : 'N/A');
const fmtINR = (n) => (n != null ? `₹${INR_FMT.format(Math.round(n))}` : 'N/A');
const fmtPct = (n) => (n != null ? `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%` : 'N/A');
const fmtPnl = (n) => (n != null ? `${n >= 0 ? '+' : ''}${fmtINR(n)}` : 'N/A');
const fmtDate = (d) => {
  if (!d) return 'N/A';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? 'N/A'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};
// Percent change of `target` relative to `base`, formatted as "(+X.XX%)"; '' if missing
const pctFrom = (target, base) =>
  target != null && base ? `(${fmtPct(((target - base) / base) * 100)})` : '';

// ── Lazy singletons ───────────────────────────────────────────────────────────
let _bot = null;
function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('YOUR_')) return null;
  if (!_bot) _bot = new TelegramBot(token, { polling: false });
  return _bot;
}

let _mailer = null;
function getMailer() {
  const user = process.env.EMAIL_USER;
  if (!user || user.includes('your.email')) return null;
  if (!_mailer) {
    _mailer = nodemailer.createTransport({
      host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return _mailer;
}

// ── Per-user Config cache (1-min TTL) ─────────────────────────────────────────
// Every alert now resolves to a specific user's own Telegram chat / email — there is
// no single shared recipient anymore. getCfg(null) (dead-code callers, tests) just
// falls through to the env-var fallbacks in sendTelegram/sendEmail.
const _cfgCache = new Map(); // userId string -> { cfg, at }
async function getCfg(userId) {
  if (!userId) return null;
  const key = String(userId);
  const hit = _cfgCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.cfg;
  const cfg = await Config.findOne({ userId }).lean().catch(() => null);
  _cfgCache.set(key, { cfg, at: Date.now() });
  return cfg;
}

/** Every user's id — for alerts about shared state (market regime, intraday, cost). */
async function allUserIds() {
  const users = await User.find().select('_id').lean().catch(() => []);
  return users.map((u) => String(u._id));
}

/** Ids of every user who has `symbol` on their own watchlist. */
async function usersWatching(symbol) {
  const configs = await Config.find({ 'watchlist.symbol': symbol })
    .select('userId')
    .lean()
    .catch(() => []);
  return configs.map((c) => String(c.userId));
}

/** Run `sendOne(userId)` for each id, independently — one failure never blocks the rest. */
async function fanOut(userIds, sendOne) {
  await Promise.all(
    (userIds ?? []).map((userId) =>
      Promise.resolve(sendOne(userId)).catch((err) =>
        logger.error('notifier: per-user send failed', { userId, error: err.message })
      )
    )
  );
}

// ── Deduplication (4-hour per alert-key) ─────────────────────────────────────
const DEDUP_MS = 4 * 60 * 60 * 1000;
const _sentAt = new Map();

function isDupe(key) {
  const last = _sentAt.get(key);
  if (last && Date.now() - last < DEDUP_MS) return true;
  _sentAt.set(key, Date.now());
  return false;
}

// ── Low-level send helpers ────────────────────────────────────────────────────
async function sendTelegram(text, userId) {
  const bot = getBot();
  if (!bot) {
    logger.debug('Telegram not configured — skipping alert');
    return;
  }
  try {
    const cfg = await getCfg(userId);
    const chatId = process.env.TELEGRAM_CHAT_ID || cfg?.telegramChatId;
    if (!chatId) {
      logger.warn('No Telegram chat ID configured', { userId });
      return;
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('Telegram send failed', { error: err.message });
  }
}

async function sendEmail({ subject, html }, userId) {
  const mailer = getMailer();
  if (!mailer) {
    logger.debug('Email not configured — skipping alert');
    return;
  }
  try {
    const cfg = await getCfg(userId);
    const to = process.env.EMAIL_TO || cfg?.emailRecipient;
    if (!to) {
      logger.warn('No email recipient configured');
      return;
    }
    await mailer.sendMail({
      from: `"SwingTrader AI" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    logger.error('Email send failed', { error: err.message });
  }
}

// ── HTML email wrapper ────────────────────────────────────────────────────────
function htmlWrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:16px}
  .card{background:#1e293b;border-radius:8px;padding:20px;max-width:560px;margin:0 auto}
  h2{margin:0 0 16px;font-size:20px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  td{padding:6px 8px;border-bottom:1px solid #334155;font-size:14px}
  td:first-child{color:#94a3b8;width:38%}
  .buy{color:#22c55e}.wait{color:#eab308}.skip{color:#ef4444}
  .pill{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:bold}
  .pill-buy{background:#166534;color:#22c55e}
  .footer{font-size:11px;color:#475569;margin-top:16px;text-align:center}
</style></head><body>
<div class="card"><h2>${title}</h2>${body}</div>
<div class="footer">SwingTrader AI • Human confirms all trades • Paper mode ON by default</div>
</body></html>`;
}

function row(label, value) {
  return `<tr><td>${label}</td><td><strong>${value}</strong></td></tr>`;
}

// ── Daily Claude cost alert — once per IST calendar day, not the shared 4h dedup ────
let _costAlertDate = null;
function alreadyAlertedForDate(dateStr) {
  if (_costAlertDate === dateStr) return true;
  _costAlertDate = dateStr;
  return false;
}

export const sendDailyClaudeCostAlert = async (totalCostInr, thresholdInr, signalCount) => {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (alreadyAlertedForDate(istDate)) return;

  const tg = [
    '💰 *Daily Claude Cost Alert*',
    '',
    `Spend today: ${fmtINR(totalCostInr)} (threshold ${fmtINR(thresholdInr)})`,
    `Signals analyzed today: ${signalCount}`,
  ].join('\n');
  const html = htmlWrap(
    'Daily Claude Cost Alert',
    `<table>${row('Spend today', fmtINR(totalCostInr))}${row('Threshold', fmtINR(thresholdInr))}${row('Signals analyzed', signalCount)}</table>`
  );
  // Claude spend is shared infrastructure cost — every user should know, not just one.
  await fanOut(await allUserIds(), (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail(
        { subject: `SwingTrader AI — Daily Claude cost ${fmtINR(totalCostInr)} exceeds ${fmtINR(thresholdInr)} threshold`, html },
        userId
      ),
    ])
  );
  logger.warn('Daily Claude cost alert fired', { totalCostInr, thresholdInr, signalCount });
};

// ── Holiday reminder — fired the prior trading evening (eveningSummary.js) ─────
export const sendHolidayReminder = async (holiday) => {
  if (isDupe(`holiday:${holiday.date}`)) return;

  const tg = [
    '📅 *Market Holiday Tomorrow*',
    '',
    `NSE is closed on *${holiday.date}* for *${holiday.name}*.`,
    'No scans, price refresh, or alerts until the next trading session.',
  ].join('\n');
  const html = htmlWrap(
    'Market Holiday Reminder',
    `<table>${row('Date', holiday.date)}${row('Holiday', holiday.name)}</table>
     <p style="color:#94a3b8;font-size:13px;margin-top:8px">
       No scans, price refresh, or alerts until the next trading session.
     </p>`
  );
  await fanOut(await allUserIds(), (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: `SwingTrader AI — NSE closed ${holiday.date} (${holiday.name})`, html }, userId),
    ])
  );
  logger.info('Holiday reminder sent', { date: holiday.date, name: holiday.name });
};

// ── 1. BUY signal alert ───────────────────────────────────────────────────────
export const sendBuyAlert = async (signal) => {
  if (isDupe(`buy:${signal.symbol}`)) return;
  const userIds = await usersWatching(signal.symbol);
  if (!userIds.length) return;

  const entryHigh = signal.entryZone?.high;
  const simons = (signal.simonsSignals?.length ? signal.simonsSignals : signal.tags) ?? [];
  const tg = [
    `🚀 *BUY SIGNAL — ${signal.symbol}*`,
    `📊 Setup: ${signal.setupType ?? 'OTHER'} | Score: ${signal.compositeScore ?? 'N/A'}/100 | Confidence: *${signal.confidence}*`,
    '',
    `💰 Entry: ${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`,
    `🛑 Stop Loss: ${fmtINR(signal.stopLoss)}`,
    `🎯 Target 1: ${fmtINR(signal.target1)} ${pctFrom(signal.target1, entryHigh)}`,
    `🏆 Target 2: ${fmtINR(signal.target2)} ${pctFrom(signal.target2, entryHigh)}`,
    `⚖️ R:R: ${fmt(signal.riskReward)}:1`,
    '',
    `📦 Shares: ${signal.shares} | Deployed: ${fmtINR(signal.capitalDeployed)} | Max Loss: ${fmtINR(signal.maxLoss)}`,
    '',
    `📈 RSI: ${fmt(signal.indicators?.rsi)} | Vol: ${fmt(signal.indicators?.volRatio)}× | Mom6m: ${fmt(signal.indicators?.momentum6m)}%`,
    simons.length ? `🚦 Simons: ${simons.join(', ')}` : null,
    signal.tailwindFactors?.length ? `🌬 Tailwinds: ${signal.tailwindFactors.join(', ')}` : null,
    '',
    signal.entryTrigger ? `⚡ Trigger: ${signal.entryTrigger}` : null,
    `⏰ Valid till: ${fmtDate(signal.signalValidTill)}${signal.exitBeforeDate ? ` | Exit before: ${fmtDate(signal.exitBeforeDate)}` : ''}`,
    '',
    signal.keyRisks?.length ? `⚠️ Risks: ${signal.keyRisks.join(', ')}` : null,
    '',
    `🧠 ${signal.reasoning ?? ''}`,
    '',
    '{{PAPER_TAG}}',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = htmlWrap(
    `🚀 BUY — ${signal.symbol}`,
    `
    <span class="pill pill-buy">BUY · ${signal.confidence}</span>
    &nbsp; Setup: <strong>${signal.setupType ?? 'OTHER'}</strong> &nbsp; Score: <strong>${signal.compositeScore ?? 'N/A'}/100</strong>
    <br><br>
    <table>
      ${row('Entry Zone', `${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`)}
      ${row('Stop Loss', fmtINR(signal.stopLoss))}
      ${row('Target 1', `${fmtINR(signal.target1)} ${pctFrom(signal.target1, entryHigh)}`)}
      ${row('Target 2', `${fmtINR(signal.target2)} ${pctFrom(signal.target2, entryHigh)}`)}
      ${row('Risk : Reward', `${fmt(signal.riskReward)}:1`)}
      ${row('Shares', signal.shares)}
      ${row('Capital Deployed', fmtINR(signal.capitalDeployed))}
      ${row('Max Loss', fmtINR(signal.maxLoss))}
      ${row('RSI / Vol / Mom6m', `${fmt(signal.indicators?.rsi)} / ${fmt(signal.indicators?.volRatio)}× / ${fmt(signal.indicators?.momentum6m)}%`)}
      ${simons.length ? row('Simons Signals', simons.join(' · ')) : ''}
      ${signal.tailwindFactors?.length ? row('Tailwinds', signal.tailwindFactors.join(' · ')) : ''}
      ${row('Valid Till', fmtDate(signal.signalValidTill))}
      ${signal.exitBeforeDate ? row('Exit Before', fmtDate(signal.exitBeforeDate)) : ''}
    </table>
    <p style="font-size:14px"><strong>Reasoning:</strong> ${signal.reasoning ?? ''}</p>
    ${signal.keyRisks?.length ? `<p style="font-size:13px;color:#f59e0b">⚠️ ${signal.keyRisks.join(' · ')}</p>` : ''}
    <p style="font-size:13px;color:#64748b">Entry trigger: ${signal.entryTrigger ?? '—'}</p>
  `
  );

  // paperTradeMode lives on each recipient's own Config, not on the shared Signal doc.
  await fanOut(userIds, async (userId) => {
    const cfg = await getCfg(userId);
    const paperTag = cfg?.paperTradeMode !== false ? '📋 _Paper Trade_' : '🔴 _LIVE Trade_';
    await Promise.all([
      sendTelegram(tg.replace('{{PAPER_TAG}}', paperTag), userId),
      sendEmail({ subject: `🚀 BUY: ${signal.symbol} (${signal.confidence})`, html }, userId),
    ]);
  });

  logger.info(`BUY alert sent for ${signal.symbol}`, { recipients: userIds.length });
};

// ── 2. WAIT → BUY upgrade ─────────────────────────────────────────────────────
export const sendWaitToBuyUpgrade = async (signal) => {
  if (isDupe(`upgrade:${signal.symbol}`)) return;
  const userIds = await usersWatching(signal.symbol);
  if (!userIds.length) return;

  const tg = [
    `⬆️ *UPGRADE: WAIT → BUY — ${signal.symbol}*`,
    '',
    `💰 Entry: ${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`,
    `🛑 SL: ${fmtINR(signal.stopLoss)} | 🎯 T1: ${fmtINR(signal.target1)} | T2: ${fmtINR(signal.target2)}`,
    `📊 R:R: ${fmt(signal.riskReward)}:1`,
    '',
    `Entry trigger met: ${signal.entryTrigger ?? '—'}`,
  ].join('\n');

  const html = htmlWrap(
    `⬆️ BUY Upgrade — ${signal.symbol}`,
    `
    <table>
      ${row('Previous Verdict', 'WAIT')}
      ${row('New Verdict', '<span class="buy">BUY</span>')}
      ${row('Entry Zone', `${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`)}
      ${row('Stop Loss', fmtINR(signal.stopLoss))}
      ${row('Target 1', fmtINR(signal.target1))}
      ${row('R:R', `${fmt(signal.riskReward)}:1`)}
    </table>
    <p style="font-size:14px">Trigger: ${signal.entryTrigger ?? '—'}</p>
  `
  );

  await fanOut(userIds, (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: `⬆️ UPGRADED to BUY: ${signal.symbol}`, html }, userId),
    ])
  );
  logger.info(`Upgrade alert sent for ${signal.symbol}`, { recipients: userIds.length });
};

// ── 2b. Entry-zone hit (intraday watcher) ─────────────────────────────────────
export const sendEntryZoneAlert = async (signal, price) => {
  if (isDupe(`entryzone:${signal._id ?? signal.symbol}`)) return;
  const userIds = await usersWatching(signal.symbol);
  if (!userIds.length) return;

  const tg = [
    `🎯 *ENTRY ZONE HIT — ${signal.symbol}*`,
    '',
    `Live: ${fmtINR(price)} — inside entry zone ${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`,
    `🛑 SL: ${fmtINR(signal.stopLoss)} | 🎯 T1: ${fmtINR(signal.target1)} | 🏆 T2: ${fmtINR(signal.target2)}`,
    `⚖️ R:R: ${fmt(signal.riskReward)}:1 | 📦 Plan: ${signal.shares ?? '—'} shares ≈ ${fmtINR(signal.capitalDeployed)}`,
    '',
    signal.entryTrigger ? `⚡ Original trigger: ${signal.entryTrigger}` : null,
    `⏰ Signal valid till: ${fmtDate(signal.signalValidTill)}`,
    '',
    '_You place the trade manually — TradeZen never auto-executes._',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = htmlWrap(
    `🎯 Entry Zone Hit — ${signal.symbol}`,
    `
    <table>
      ${row('Live Price', fmtINR(price))}
      ${row('Entry Zone', `${fmtINR(signal.entryZone?.low)} – ${fmtINR(signal.entryZone?.high)}`)}
      ${row('Stop Loss', fmtINR(signal.stopLoss))}
      ${row('Target 1', fmtINR(signal.target1))}
      ${row('Target 2', fmtINR(signal.target2))}
      ${row('Risk : Reward', `${fmt(signal.riskReward)}:1`)}
      ${row('Planned Shares', signal.shares ?? '—')}
      ${row('Valid Till', fmtDate(signal.signalValidTill))}
    </table>
    <p style="font-size:13px;color:#64748b">Original trigger: ${signal.entryTrigger ?? '—'}</p>
  `
  );

  await fanOut(userIds, (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: `🎯 Entry zone hit: ${signal.symbol} @ ${fmtINR(price)}`, html }, userId),
    ])
  );
  logger.info(`Entry-zone alert sent for ${signal.symbol}`, { recipients: userIds.length });
};

// ── 2c. Intraday strategy trigger (EXPERIMENTAL — paper-tracked, not a trade call) ──
// Covers all three intraday setups (ORB, VWAP_REVERSION, MOMENTUM_CONTINUATION); the
// thesis line adapts to setupType + direction so a SHORT breakdown or a mean-reversion
// fade reads correctly instead of always saying "broke above."
const SETUP_LABELS = {
  ORB: 'ORB',
  VWAP_REVERSION: 'VWAP Reversion',
  MOMENTUM_CONTINUATION: 'Momentum Continuation',
};

function intradayThesisLine(sig) {
  const isLong = sig.direction !== 'SHORT';
  if (sig.setupType === 'VWAP_REVERSION') {
    return `Extended ${isLong ? 'below' : 'above'} VWAP band, fading back toward ${fmtINR(sig.vwap)}`;
  }
  if (sig.setupType === 'MOMENTUM_CONTINUATION') {
    return `Pullback to EMA9 within an established ${isLong ? 'up' : 'down'}trend`;
  }
  return isLong
    ? `Broke above opening range high ${fmtINR(sig.orHigh)} (range ${fmtINR(sig.orLow)} – ${fmtINR(sig.orHigh)})`
    : `Broke below opening range low ${fmtINR(sig.orLow)} (range ${fmtINR(sig.orLow)} – ${fmtINR(sig.orHigh)})`;
}

export const sendOrbAlert = async (sig) => {
  if (isDupe(`intraday:${sig.symbol}:${sig.sessionDate}:${sig.setupType}:${sig.direction}`)) return;

  const label = SETUP_LABELS[sig.setupType] ?? sig.setupType ?? 'Intraday';
  const dirTag = sig.direction === 'SHORT' ? 'SHORT' : 'LONG';

  const tg = [
    `⚡ *INTRADAY ${label.toUpperCase()} — ${sig.symbol} (${dirTag})* _(experimental)_`,
    '',
    intradayThesisLine(sig),
    `Live: ${fmtINR(sig.breakoutPrice)} | VWAP: ${fmtINR(sig.vwap)} | Rel Vol: ${fmt(sig.relVolume, 1)}×`,
    `🛑 Suggested SL: ${fmtINR(sig.suggestedStop)} | 🎯 Target: ${fmtINR(sig.suggestedTarget)}`,
    sig.shares ? `📦 Paper plan: ${sig.shares} shares ≈ ${fmtINR(sig.capitalDeployed)} (virtual capital)` : null,
    '',
    `📊 _Paper-tracked only — this alert builds the ${label} track record; it is not a trade call yet._`,
    '⏱ Data is ~15 min delayed (yfinance). Square off any intraday position by 15:15 IST.',
    '_TradeZen never auto-executes._',
  ].join('\n');

  const html = htmlWrap(
    `⚡ Intraday ${label} — ${sig.symbol} (${dirTag}, experimental)`,
    `
    <table>
      ${row('Direction', dirTag)}
      ${row('Entry Price', fmtINR(sig.breakoutPrice))}
      ${sig.orHigh != null ? row('Opening Range', `${fmtINR(sig.orLow)} – ${fmtINR(sig.orHigh)} (${sig.orWindowMinutes} min)`) : ''}
      ${row('VWAP', fmtINR(sig.vwap))}
      ${row('Relative Volume', `${fmt(sig.relVolume, 1)}×`)}
      ${row('Suggested SL', fmtINR(sig.suggestedStop))}
      ${row('Target', fmtINR(sig.suggestedTarget))}
      ${row('Session', sig.sessionDate)}
    </table>
    <p style="font-size:13px;color:#f59e0b">📊 Experimental — paper-tracked to build the ${label}
    track record. Not a trade call. Data ~15 min delayed; square off by 15:15 IST.</p>
  `
  );

  // Intraday is shared/global (not per-user) — every registered user gets it.
  await fanOut(await allUserIds(), (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: `⚡ ${label} (experimental): ${sig.symbol} ${dirTag} @ ${fmtINR(sig.breakoutPrice)}`, html }, userId),
    ])
  );
  logger.info(`Intraday ${label} alert sent for ${sig.symbol}`, { direction: sig.direction });
};

// ── 2d. ORB square-off reminder (15:00 IST — intraday positions close by 15:15) ─
export const sendOrbSquareOffReminder = async (signals) => {
  if (!signals?.length) return;
  const sessionDate = signals[0].sessionDate;
  if (isDupe(`orbsquareoff:${sessionDate}`)) return;

  const lines = signals.map(
    (s) => `• ${s.symbol} — entry ${fmtINR(s.breakoutPrice)}, SL ${fmtINR(s.suggestedStop)}`
  );
  const tg = [
    `⏰ *ORB SQUARE-OFF REMINDER* _(15:15 IST)_`,
    '',
    `Today's ORB paper trade${signals.length > 1 ? 's' : ''}:`,
    ...lines,
    '',
    '_If you mirrored any of these manually, square off by 15:15 IST — intraday positions_',
    '_must not be carried overnight. Paper exits settle automatically at 15:20._',
  ].join('\n');

  await fanOut(await allUserIds(), (userId) => sendTelegram(tg, userId));
  logger.info(`ORB square-off reminder sent (${signals.length} open)`);
};

// ── 3. Stop loss warning ──────────────────────────────────────────────────────
export const sendSlWarning = async (trade) => {
  if (isDupe(`sl:${trade._id}`)) return;

  const pnlPct = trade.unrealizedPnlPct ?? 0;
  const tg = [
    `⚠️ *SL WARNING — ${trade.symbol}*`,
    '',
    `Current: ${fmtINR(trade.currentPrice)} | SL: ${fmtINR(trade.stopLoss)}`,
    `Unrealized P&L: ${fmtPct(pnlPct)}`,
    '',
    `_Review your stop loss. Human confirmation required before any action._`,
  ].join('\n');

  await Promise.all([
    sendTelegram(tg, trade.userId),
    sendEmail(
      {
        subject: `⚠️ SL Warning: ${trade.symbol} approaching stop loss`,
        html: htmlWrap(
          `⚠️ Stop Loss Warning — ${trade.symbol}`,
          `
        <table>
          ${row('Symbol', trade.symbol)}
          ${row('Current Price', fmtINR(trade.currentPrice))}
          ${row('Stop Loss', fmtINR(trade.stopLoss))}
          ${row('Unrealized P&L', `<span class="${pnlPct >= 0 ? 'buy' : 'skip'}">${fmtPct(pnlPct)}</span>`)}
          ${row('Entry Price', fmtINR(trade.entryPrice))}
          ${row('Shares', trade.shares)}
        </table>
        <p style="color:#f59e0b;font-size:13px">Review your stop loss. Human confirmation required before any action.</p>
      `
        ),
      },
      trade.userId
    ),
  ]);
  logger.info(`SL warning sent for ${trade.symbol}`);
};

// ── 4. Target 1 hit ───────────────────────────────────────────────────────────
export const sendTarget1Hit = async (trade) => {
  if (isDupe(`t1:${trade._id}`)) return;

  const trailedTo = trade.slTrailed && trade.slTrailedTo != null ? trade.slTrailedTo : trade.entryPrice;
  const tg = [
    `🎯 *TARGET 1 HIT — ${trade.symbol}*`,
    '',
    `T1: ${fmtINR(trade.target1)} ✓`,
    `Unrealized P&L: ${fmtPct(trade.unrealizedPnlPct)}`,
    '',
    `Stop loss trailed to ${fmtINR(trailedTo)} — ratchets up with an ATR trail from here.`,
    `_Next target: ${fmtINR(trade.target2)}_`,
  ].join('\n');

  await Promise.all([
    sendTelegram(tg, trade.userId),
    sendEmail(
      {
        subject: `🎯 T1 Hit: ${trade.symbol} — SL trailed to ${fmtINR(trailedTo)}`,
        html: htmlWrap(
          `🎯 Target 1 Hit — ${trade.symbol}`,
          `
        <table>
          ${row('Target 1', `${fmtINR(trade.target1)} ✓`)}
          ${row('Target 2', fmtINR(trade.target2))}
          ${row('Entry', fmtINR(trade.entryPrice))}
          ${row('SL trailed to', fmtINR(trailedTo))}
          ${row('Unrealized P&L', `<span class="buy">${fmtPct(trade.unrealizedPnlPct)}</span>`)}
        </table>
        <p style="color:#22c55e;font-size:13px">Stop trailed to ${fmtINR(trailedTo)} and will ratchet up with the ATR trail as the price makes new highs.</p>
      `
        ),
      },
      trade.userId
    ),
  ]);
  logger.info(`Target 1 alert sent for ${trade.symbol}`);
};

// ── 5. Target 2 hit ───────────────────────────────────────────────────────────
export const sendTarget2Hit = async (trade) => {
  if (isDupe(`t2:${trade._id}`)) return;

  const tg = [
    `🏆 *TARGET 2 HIT — ${trade.symbol}*`,
    '',
    `T2: ${fmtINR(trade.target2)} ✓`,
    `Realized P&L: ${fmtPnl(trade.realizedPnl)} (${fmtPct(trade.realizedPnlPct)})`,
    '',
    `_Full target achieved. Consider closing the position._`,
  ].join('\n');

  await Promise.all([
    sendTelegram(tg, trade.userId),
    sendEmail(
      {
        subject: `🏆 T2 Hit: ${trade.symbol} — Full target achieved`,
        html: htmlWrap(
          `🏆 Target 2 Hit — ${trade.symbol}`,
          `
        <table>
          ${row('Target 2', `${fmtINR(trade.target2)} ✓`)}
          ${row('Entry', fmtINR(trade.entryPrice))}
          ${row('Realized P&L', `<span class="buy">${fmtPnl(trade.realizedPnl)}</span>`)}
          ${row('Return', `<span class="buy">${fmtPct(trade.realizedPnlPct)}</span>`)}
          ${row('Shares', trade.shares)}
        </table>
        <p style="color:#22c55e;font-size:14px">🏆 Full target achieved. Consider closing the position.</p>
      `
        ),
      },
      trade.userId
    ),
  ]);
  logger.info(`Target 2 alert sent for ${trade.symbol}`);
};

// ── 5b. Earnings exit reminder (doc Notification 10) ──────────────────────────
/**
 * Remind to exit a position before its earnings date (gap-risk avoidance).
 *
 * @param {object} trade - Trade with { symbol, earningsTimestamp, currentPrice,
 *                          unrealizedPnl, unrealizedPnlPct, daysToEarnings? }
 * @returns {Promise<void>}
 */
export const sendEarningsReminder = async (trade) => {
  if (isDupe(`earnings:${trade._id ?? trade.symbol}`)) return;

  const earningsDate = trade.earningsTimestamp ? new Date(trade.earningsTimestamp * 1000) : null;
  const days =
    trade.daysToEarnings ??
    (earningsDate ? Math.floor((earningsDate.getTime() - Date.now()) / 86_400_000) : null);
  const earningsLine = earningsDate
    ? `Earnings: ${fmtDate(earningsDate)}${days != null ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`
    : 'Earnings approaching';

  const tg = [
    `📅 *EARNINGS EXIT REMINDER — ${trade.symbol}*`,
    '',
    earningsLine,
    `Current: ${fmtINR(trade.currentPrice)} | P&L: ${fmtPnl(trade.unrealizedPnl)} (${fmtPct(trade.unrealizedPnlPct)})`,
    '',
    `_Consider exiting before earnings to avoid gap risk. Human confirmation required._`,
  ].join('\n');

  await Promise.all([
    sendTelegram(tg, trade.userId),
    sendEmail(
      {
        subject: `📅 Earnings Reminder: ${trade.symbol} — consider exit`,
        html: htmlWrap(
          `📅 Earnings Exit Reminder — ${trade.symbol}`,
          `
        <table>
          ${row('Symbol', trade.symbol)}
          ${row('Earnings Date', earningsDate ? fmtDate(earningsDate) : 'Approaching')}
          ${days != null ? row('Days Away', days) : ''}
          ${row('Current Price', fmtINR(trade.currentPrice))}
          ${row('Unrealized P&L', `<span class="${(trade.unrealizedPnl ?? 0) >= 0 ? 'buy' : 'skip'}">${fmtPnl(trade.unrealizedPnl)} (${fmtPct(trade.unrealizedPnlPct)})</span>`)}
        </table>
        <p style="color:#f59e0b;font-size:13px">Consider exiting before earnings to avoid gap risk. Human confirmation required.</p>
      `
        ),
      },
      trade.userId
    ),
  ]);
  logger.info(`Earnings reminder sent for ${trade.symbol}`);
};

// ── 6. Bear mode alert ────────────────────────────────────────────────────────
export const sendBearModeAlert = async () => {
  if (isDupe('bear:market')) return;

  const tg = [
    `🐻 *BEAR MODE ACTIVATED*`,
    '',
    `Nifty 50 has dropped below its 20 EMA.`,
    `All new BUY signals are *blocked* until the index recovers.`,
    '',
    `_Review open positions and tighten stop losses._`,
  ].join('\n');

  const html = htmlWrap(
    '🐻 Bear Mode Activated',
    `
    <p>Nifty 50 has dropped below its 20 EMA. All new BUY signals are blocked until the index recovers.</p>
    <ul>
      <li>Review all open positions</li>
      <li>Consider tightening stop losses</li>
      <li>No new positions until BULL mode resumes</li>
    </ul>
  `
  );
  await fanOut(await allUserIds(), (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: '🐻 BEAR MODE — All BUY signals blocked', html }, userId),
    ])
  );
  logger.warn('Bear mode alert sent');
};

// ── 7. VIX spike alert ────────────────────────────────────────────────────────
export const sendVixSpikeAlert = async (vix) => {
  if (isDupe('vix:spike')) return;

  const level = vix > 25 ? 'EXTREME FEAR' : 'ELEVATED';
  const tg = [
    `📊 *VIX SPIKE — ${level}*`,
    '',
    `India VIX: *${fmt(vix)}*`,
    vix > 25
      ? '⚠️ Extreme fear in the market. High risk of sharp moves.'
      : 'Elevated volatility — widen stop losses and reduce position sizes.',
  ].join('\n');

  await fanOut(await allUserIds(), (userId) => sendTelegram(tg, userId));
  logger.warn(`VIX spike alert sent (${fmt(vix)})`);
};

// ── 8. Morning brief ──────────────────────────────────────────────────────────
export const sendMorningBrief = async (data, userId) => {
  if (!data || Object.keys(data).length === 0) return;

  const tg = [
    `🌅 *MORNING BRIEF — ${data.dateStr ?? new Date().toLocaleDateString('en-IN')}*`,
    '',
    data.nifty
      ? `Nifty: ${fmtINR(data.nifty.price)} (${fmtPct(data.nifty.changePct)}) | ${data.nifty.aboveEma20 ? '✅ Above EMA' : '❌ Below EMA'}`
      : '',
    data.vix ? `VIX: ${fmt(data.vix)}` : '',
    '',
    data.openTradesCount != null ? `📊 Open Positions: ${data.openTradesCount}` : '',
    data.todaySignals != null ? `📡 Signals Today: ${data.todaySignals}` : '',
    '',
    `_Market opens at 9:15 AM IST. Stay disciplined._`,
  ]
    .filter(Boolean)
    .join('\n');

  await Promise.all([
    sendTelegram(tg, userId),
    sendEmail(
      {
        subject: `🌅 Morning Brief — ${data.dateStr ?? new Date().toLocaleDateString('en-IN')}`,
        html: htmlWrap(
          '🌅 Morning Brief',
          `
        <table>
          ${data.nifty ? row('Nifty 50', `${fmtINR(data.nifty.price)} (${fmtPct(data.nifty.changePct)})`) : ''}
          ${data.vix ? row('India VIX', fmt(data.vix)) : ''}
          ${data.openTradesCount != null ? row('Open Positions', data.openTradesCount) : ''}
          ${data.todaySignals != null ? row('Signals Today', data.todaySignals) : ''}
          ${data.marketMode ? row('Market Mode', data.marketMode) : ''}
        </table>
      `
        ),
      },
      userId
    ),
  ]);
  logger.info('Morning brief sent', { userId });
};

// ── 9. Evening summary ────────────────────────────────────────────────────────
export const sendEveningSummary = async (data, userId) => {
  if (!data || Object.keys(data).length === 0) return;

  const tg = [
    `🌆 *EVENING SUMMARY*`,
    '',
    data.closedTrades != null ? `Trades Closed Today: ${data.closedTrades}` : '',
    data.dayPnl != null ? `Day P&L: ${fmtPnl(data.dayPnl)} (${fmtPct(data.dayPnlPct)})` : '',
    data.signalsGenerated != null ? `Signals Generated: ${data.signalsGenerated}` : '',
    data.claudeCostInr != null ? `Claude API Cost: ₹${fmt(data.claudeCostInr, 4)}` : '',
    '',
    data.openTradesCount != null
      ? `Open Positions: ${data.openTradesCount} (review SLs overnight)`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  await Promise.all([
    sendTelegram(tg, userId),
    sendEmail(
      {
        subject: `🌆 Evening Summary — ${new Date().toLocaleDateString('en-IN')}`,
        html: htmlWrap(
          '🌆 Evening Summary',
          `
        <table>
          ${data.closedTrades != null ? row('Trades Closed', data.closedTrades) : ''}
          ${data.dayPnl != null ? row('Day P&L', `<span class="${data.dayPnl >= 0 ? 'buy' : 'skip'}">${fmtPnl(data.dayPnl)}</span>`) : ''}
          ${data.signalsGenerated != null ? row('Signals Generated', data.signalsGenerated) : ''}
          ${data.claudeCostInr != null ? row('Claude API Cost', `₹${fmt(data.claudeCostInr, 4)}`) : ''}
          ${data.openTradesCount != null ? row('Open Positions', data.openTradesCount) : ''}
        </table>
      `
        ),
      },
      userId
    ),
  ]);
  logger.info('Evening summary sent', { userId });
};

// ── 9b. Next-session watchlist (EOD prep) ──────────────────────────────────────
/**
 * Send the post-close watchlist of next-session candidates. These are gate-qualified
 * setups to CONFIRM live at the next open — not tradeable BUY signals (no overnight action).
 *
 * @param {object} data - { dateStr, marketMode, candidates: [{ symbol, compositeScore,
 *   gatesPassed, suggestedEntry, suggestedStopLoss, suggestedTarget1, rsi }] }
 * @returns {Promise<void>}
 */
export const sendWatchlistPrep = async (data) => {
  const list = data?.candidates ?? [];
  if (!list.length) {
    logger.info('Watchlist prep: no candidates — alert skipped');
    return;
  }
  const dateStr = data.dateStr ?? new Date().toLocaleDateString('en-IN');

  const lines = list
    .slice(0, 10)
    .map(
      (c, i) =>
        `${i + 1}. *${c.symbol}* — score ${Math.round(c.compositeScore ?? 0)} · ${c.gatesPassed ?? 0}/8 gates` +
        (c.suggestedEntry ? `\n   entry ~${fmtINR(c.suggestedEntry)} · SL ${fmtINR(c.suggestedStopLoss)} · T1 ${fmtINR(c.suggestedTarget1)}` : '')
    );

  const tg = [
    `🔭 *NEXT-SESSION WATCHLIST — ${dateStr}*`,
    data.marketMode ? `Market mode: ${data.marketMode}` : '',
    `${list.length} candidate${list.length === 1 ? '' : 's'} cleared the gates on today's close.`,
    '',
    ...lines,
    '',
    `_Confirm live at the open — these are watch candidates, not signals._`,
  ]
    .filter(Boolean)
    .join('\n');

  const rows = list
    .slice(0, 10)
    .map(
      (c) =>
        row(
          `<b>${c.symbol}</b>`,
          `score ${Math.round(c.compositeScore ?? 0)} · ${c.gatesPassed ?? 0}/8` +
            (c.suggestedEntry
              ? ` · entry ${fmtINR(c.suggestedEntry)} / SL ${fmtINR(c.suggestedStopLoss)} / T1 ${fmtINR(c.suggestedTarget1)}`
              : '')
        )
    )
    .join('');

  const html = htmlWrap(
    '🔭 Next-Session Watchlist',
    `<p>${list.length} candidates cleared the gates on today's close. Confirm live at the open.</p>
     <table>${rows}</table>`
  );
  // Shared discovery output (universe-wide, not exclusively any one user's watchlist) —
  // every registered user gets it.
  await fanOut(await allUserIds(), (userId) =>
    Promise.all([
      sendTelegram(tg, userId),
      sendEmail({ subject: `🔭 Next-session watchlist (${list.length}) — ${dateStr}`, html }, userId),
    ])
  );
  logger.info('Watchlist prep alert sent', { candidates: list.length });
};

// ── 9c. Weekly calibration / decision-quality review ───────────────────────────
/**
 * Send the weekly calibration review — the continuous-improvement feedback nudge.
 * Summarises whether confidence is meaningful (hit rate by tier, market-adjusted),
 * go-live readiness, and any signal decay. Honest by design: reports "insufficient
 * data" when the sample is too thin to judge.
 *
 * @param {object} report - getDecisionQualityReport() output
 * @param {string} userId
 * @returns {Promise<void>}
 */
export const sendDecisionQualityReport = async (report, userId) => {
  if (!report) return;
  const sc = report.signalCalibration ?? {};
  const tb = report.tradeBased ?? {};
  const conf = sc.byConfidence ?? {};
  const confLine = (k) => {
    const g = conf[k];
    if (!g || g.n === 0) return '—';
    const decided = g.win + g.loss;
    return g.hitRate != null
      ? `${g.hitRate}% (${decided} resolved${g.enough ? '' : ', low-n'})`
      : `— (0 resolved of ${g.n})`;
  };
  const decay = tb.decayFlags ?? [];

  const tg = [
    `📐 *WEEKLY CALIBRATION REVIEW*`,
    '',
    `_${report.verdict?.message ?? 'No verdict.'}_`,
    '',
    `*Hit rate by confidence* (market-adjusted):`,
    `  HIGH:   ${confLine('HIGH')}`,
    `  MEDIUM: ${confLine('MEDIUM')}`,
    `  LOW:    ${confLine('LOW')}`,
    '',
    `Signals: ${sc.signalsConsidered ?? 0} (resolved ${sc.resolved ?? 0}, open ${sc.open ?? 0})`,
    `Paper trades: ${tb.closedTrades ?? 0} · go-live: ${tb.goLive?.ready ? '✅ READY' : '⏳ not ready'}`,
    decay.length ? `⚠️ Decay: ${decay.map((f) => `${f.key} ${f.winRate}%`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await Promise.all([
    sendTelegram(tg, userId),
    sendEmail(
      {
        subject: '📐 Weekly Calibration Review',
        html: htmlWrap(
          '📐 Weekly Calibration Review',
          `<p><i>${report.verdict?.message ?? 'No verdict.'}</i></p>
         <table>
           ${row('HIGH confidence', confLine('HIGH'))}
           ${row('MEDIUM confidence', confLine('MEDIUM'))}
           ${row('LOW confidence', confLine('LOW'))}
           ${row('Signals (resolved/open)', `${sc.resolved ?? 0} / ${sc.open ?? 0} of ${sc.signalsConsidered ?? 0}`)}
           ${row('Paper trades', tb.closedTrades ?? 0)}
           ${row('Go-live', tb.goLive?.ready ? 'READY' : 'not ready')}
           ${decay.length ? row('Decay flags', decay.map((f) => `${f.key} ${f.winRate}%`).join(', ')) : ''}
         </table>
         <p style="color:#94a3b8;font-size:12px">Hit rates are market-adjusted (excess over Nifty). Trade-based metrics take over as the paper-trade record grows.</p>`
        ),
      },
      userId
    ),
  ]);
  logger.info('Decision-quality report sent', {
    resolved: sc.resolved,
    calibrated: report.verdict?.calibrated,
  });
};

// ── Utility exports ───────────────────────────────────────────────────────────

/**
 * Clear in-memory deduplication state.
 * Use in test scripts so alerts are not suppressed by a previous run.
 */
export const clearDedupCache = () => {
  _sentAt.clear();
  logger.debug('Dedup cache cleared');
};

/**
 * Send a one-off test message to the configured Telegram chat (for /api/test/telegram).
 * Reports success/failure directly (does not swallow the send error like alerts do).
 *
 * @param {string} [text] - Custom message; a default test message is used if omitted
 * @param {string} userId - Whose Config.telegramChatId to use
 * @returns {Promise<{ ok: boolean, chatId?: string, message?: string, reason?: string }>}
 */
export const sendTestMessage = async (text, userId) => {
  const cfg = await getCfg(userId);
  const bot = getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID || cfg?.telegramChatId;
  const message =
    text || `🔔 TradeZen test alert — ${new Date().toISOString()}. Telegram alerts are working.`;

  if (!bot) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not set or contains placeholder' };
  if (!chatId)
    return { ok: false, reason: 'No chat ID (TELEGRAM_CHAT_ID or Config.telegramChatId)' };

  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    logger.info('Test Telegram message sent', { chatId });
    return { ok: true, chatId, message };
  } catch (err) {
    logger.error('Test Telegram send failed', { error: err.message });
    return { ok: false, reason: err.message };
  }
};

/**
 * Verify Telegram bot token and SMTP credentials without sending any message.
 * Returns a report object — never throws.
 *
 * @param {string} [userId] - Whose Config to check; env-var fallbacks only when omitted
 * @returns {Promise<{ telegram: { ok: boolean, reason?: string, username?: string }, email: { ok: boolean, reason?: string, to?: string } }>}
 */
export const testConnections = async (userId) => {
  const cfg = await getCfg(userId);
  const report = { telegram: null, email: null };

  // ── Telegram ───────────────────────────────────────────────────────────────
  const bot = getBot();
  if (!bot) {
    report.telegram = { ok: false, reason: 'TELEGRAM_BOT_TOKEN not set or contains placeholder' };
  } else {
    const chatId = process.env.TELEGRAM_CHAT_ID || cfg?.telegramChatId;
    if (!chatId) {
      report.telegram = {
        ok: false,
        reason: 'No chat ID (TELEGRAM_CHAT_ID env var or Config.telegramChatId)',
      };
    } else {
      try {
        const me = await bot.getMe(); // lightweight API call — no message sent
        report.telegram = { ok: true, username: me.username, chatId };
      } catch (err) {
        report.telegram = { ok: false, reason: err.message };
      }
    }
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  const mailer = getMailer();
  if (!mailer) {
    report.email = { ok: false, reason: 'EMAIL_USER not set or contains placeholder' };
  } else {
    const to = process.env.EMAIL_TO || cfg?.emailRecipient;
    if (!to) {
      report.email = {
        ok: false,
        reason: 'No recipient (EMAIL_TO env var or Config.emailRecipient)',
      };
    } else {
      try {
        await mailer.verify(); // SMTP handshake without sending
        report.email = { ok: true, to, from: process.env.EMAIL_USER };
      } catch (err) {
        report.email = { ok: false, reason: err.message };
      }
    }
  }

  return report;
};

// ── 10. Weekly report ─────────────────────────────────────────────────────────
export const sendWeeklyReport = async (data, userId) => {
  if (!data || Object.keys(data).length === 0) return;

  const tg = [
    `📈 *WEEKLY PERFORMANCE REPORT*`,
    '',
    data.totalTrades != null
      ? `Total Trades: ${data.totalTrades} (W: ${data.wins ?? 0} / L: ${data.losses ?? 0})`
      : '',
    data.winRate != null ? `Win Rate: ${fmt(data.winRate * 100)}%` : '',
    data.totalPnl != null ? `Total P&L: ${fmtPnl(data.totalPnl)}` : '',
    data.avgRR != null ? `Avg R:R: ${fmt(data.avgRR)}:1` : '',
    data.maxDrawdown != null ? `Max Drawdown: ${fmtPct(data.maxDrawdown)}` : '',
    data.claudeCostInr != null ? `Claude API Cost: ₹${fmt(data.claudeCostInr, 4)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await Promise.all([
    sendTelegram(tg, userId),
    sendEmail(
      {
        subject: `📈 Weekly Report — SwingTrader AI`,
        html: htmlWrap(
          '📈 Weekly Performance Report',
          `
        <table>
          ${data.totalTrades != null ? row('Total Trades', data.totalTrades) : ''}
          ${data.winRate != null ? row('Win Rate', `${fmt(data.winRate * 100)}%`) : ''}
          ${data.totalPnl != null ? row('Total P&L', `<span class="${(data.totalPnl ?? 0) >= 0 ? 'buy' : 'skip'}">${fmtPnl(data.totalPnl)}</span>`) : ''}
          ${data.avgRR != null ? row('Avg R:R', `${fmt(data.avgRR)}:1`) : ''}
          ${data.maxDrawdown != null ? row('Max Drawdown', fmtPct(data.maxDrawdown)) : ''}
          ${data.signalsGenerated != null ? row('Signals Generated', data.signalsGenerated) : ''}
          ${data.claudeCostInr != null ? row('Claude API Cost', `₹${fmt(data.claudeCostInr, 4)}`) : ''}
        </table>
      `
        ),
      },
      userId
    ),
  ]);
  logger.info('Weekly report sent', { userId });
};
