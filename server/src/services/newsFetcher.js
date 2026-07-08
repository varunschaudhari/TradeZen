/**
 * @file newsFetcher.js
 * @description Flow 6 — Gate 8 news intelligence. Gathers headlines from 3 sources
 *              (see newsSources.js), runs an auto-negative keyword block, scores
 *              sentiment (keyword by default, Claude when NEWS_USE_CLAUDE_SENTIMENT),
 *              and caches per symbol for 4 hours (in-memory + NewsCache TTL collection).
 * @author TradeZen Team
 * @created 2026-06-13
 * @lastModified 2026-06-20
 */

import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import NewsCache from '../models/NewsCache.js';
import {
  NEGATIVE_NEWS_KEYWORDS,
  NEWS_AUTO_NEGATIVE_SCORE,
  NEWS_CACHE_TTL_MS,
  NEWS_MAX_HEADLINES,
  NEWS_SENTIMENT_NEGATIVE_MAX,
  NEWS_SENTIMENT_POSITIVE_MIN,
  NEWS_USE_CLAUDE_SENTIMENT,
  SENTIMENTS,
} from '../config/constants.js';
import { logger } from '../config/logger.js';
import { gatherHeadlines } from './newsSources.js';

const POSITIVE_KEYWORDS = [
  'bullish',
  'breakout',
  'beat',
  'surge',
  'rally',
  'upgrade',
  'strong',
  'growth',
  'record',
  'profit',
  'outperform',
  'upside',
  'gains',
  'rise',
  'buy',
  'positive',
  'expansion',
  'order',
  'contract',
  'deal',
  'acquisition',
  'dividend',
  'buyback',
];
const NEGATIVE_SENTIMENT_KEYWORDS = [
  'loss',
  'crash',
  'downgrade',
  'selloff',
  'weak',
  'decline',
  'default',
  'debt',
  'penalty',
  'fine',
  'lawsuit',
  'miss',
  'cut',
  'layoff',
  'fall',
  'slump',
  'plunge',
];

let _client = null;
function claudeClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── In-memory cache (primary; DB is the durable layer) ─────────────────────────
/** @type {Map<string, { result: object, expiresAt: number }>} */
const memCache = new Map();

function getMemCache(symbol) {
  const entry = memCache.get(symbol);
  if (entry && Date.now() < entry.expiresAt) return entry.result;
  memCache.delete(symbol);
  return null;
}

function setMemCache(symbol, result) {
  const jitter = (Math.random() - 0.5) * 10 * 60 * 1000; // ±5 min, avoids cache stampede
  memCache.set(symbol, { result, expiresAt: Date.now() + NEWS_CACHE_TTL_MS + jitter });
}

/**
 * Read a fresh cached result from the NewsCache collection (if DB connected).
 *
 * @param {string} symbol - NSE symbol
 * @returns {Promise<object|null>} Cached result or null
 */
async function getDbCache(symbol) {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const doc = await NewsCache.findOne({ symbol }).lean();
    if (!doc?.fetchedAt) return null;
    if (Date.now() - new Date(doc.fetchedAt).getTime() > NEWS_CACHE_TTL_MS) return null;
    return {
      headlines: doc.headlines,
      sentiment: doc.sentiment,
      sentimentScore: doc.sentimentScore,
      sources: doc.sources,
      autoNegative: doc.autoNegative,
      reason: null,
    };
  } catch (err) {
    logger.error('NewsCache read failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Persist a result to both cache layers.
 *
 * @param {string} symbol - NSE symbol
 * @param {object} result - News result to cache
 * @returns {Promise<void>}
 */
async function persistCache(symbol, result) {
  setMemCache(symbol, result);
  if (mongoose.connection.readyState !== 1) return;
  try {
    await NewsCache.updateOne(
      { symbol },
      {
        $set: {
          symbol,
          headlines: result.headlines,
          sentiment: result.sentiment,
          sentimentScore: result.sentimentScore,
          sources: result.sources,
          autoNegative: result.autoNegative,
          fetchedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error('NewsCache write failed', { symbol, error: err.message });
  }
}

// ── Auto-negative + sentiment scoring ──────────────────────────────────────────
/**
 * Instant Gate-8 block: true if any headline contains an auto-negative keyword.
 *
 * @param {string[]} headlines - Headlines to scan
 * @returns {{ keyword: string, headline: string }|null} First match, or null
 */
export function detectAutoNegative(headlines) {
  for (const headline of headlines) {
    const lower = String(headline).toLowerCase();
    const keyword = NEGATIVE_NEWS_KEYWORDS.find((kw) => lower.includes(kw));
    if (keyword) return { keyword, headline };
  }
  return null;
}

/**
 * Keyword-based sentiment (default scorer — free, fast).
 *
 * @param {string[]} headlines - Headlines to score
 * @returns {{ sentiment: string, sentimentScore: number }}
 */
export function scoreHeadlinesKeyword(headlines) {
  let pos = 0;
  let neg = 0;
  for (const h of headlines) {
    const lower = h.toLowerCase();
    pos += POSITIVE_KEYWORDS.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
    neg += NEGATIVE_SENTIMENT_KEYWORDS.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
  }
  let sentiment = SENTIMENTS.NEUTRAL;
  if (neg > pos + 1) sentiment = SENTIMENTS.NEGATIVE;
  else if (pos > neg + 1) sentiment = SENTIMENTS.POSITIVE;
  return { sentiment, sentimentScore: pos - neg };
}

/**
 * Claude-based sentiment: rates each headline -10..+10 and classifies the total.
 * Falls back to keyword scoring on any failure.
 *
 * @param {string[]} headlines - Headlines to score
 * @param {string} symbol - NSE symbol (for context)
 * @returns {Promise<{ sentiment: string, sentimentScore: number }>}
 */
export async function scoreHeadlinesClaude(headlines, symbol) {
  // Haiku, not the main CLAUDE_MODEL: sentiment runs on every candidate each scan
  // (not behind the 5-gate cost guard), so it must be the cheapest tier.
  const model = process.env.CLAUDE_SENTIMENT_MODEL ?? 'claude-haiku-4-5';
  const list = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const prompt = `Rate each headline for ${symbol} stock on NSE from -10 (very negative) to +10 (very positive). Consider impact on the stock price specifically. Return ONLY JSON: {"scores":[numbers],"total":number,"sentiment":"POSITIVE"|"NEUTRAL"|"NEGATIVE"}\nHeadlines:\n${list}`;
  try {
    const res = await claudeClient().messages.create({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (res.content?.[0]?.text ?? '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '');
    const parsed = JSON.parse(raw);
    const total = typeof parsed.total === 'number' ? parsed.total : 0;
    return { sentiment: classifyByScore(total), sentimentScore: total };
  } catch (err) {
    logger.warn('Claude sentiment failed — falling back to keyword scoring', {
      symbol,
      error: err.message,
    });
    return scoreHeadlinesKeyword(headlines);
  }
}

/**
 * Classify a Claude-scale sentiment total into the sentiment enum.
 *
 * @param {number} total - Summed headline score (-10..+10 each)
 * @returns {string} One of SENTIMENTS
 */
export function classifyByScore(total) {
  if (total > NEWS_SENTIMENT_POSITIVE_MIN) return SENTIMENTS.POSITIVE;
  if (total < NEWS_SENTIMENT_NEGATIVE_MAX) return SENTIMENTS.NEGATIVE;
  return SENTIMENTS.NEUTRAL;
}

// ── Public API ──────────────────────────────────────────────────────────────────
/**
 * Fetch + score news for a stock (doc-named entry, Section 7).
 *
 * @param {string} symbol - NSE symbol (e.g. 'ICICIBANK')
 * @param {string} [companyName] - Full company name for better matching
 * @returns {Promise<{ headlines: string[], sentiment: string, sentimentScore: number, autoNegative: boolean, reason: string|null, sources: string[] }>}
 */
export const fetchNewsForStock = async (symbol, companyName = '') => {
  const cached = getMemCache(symbol) ?? (await getDbCache(symbol));
  if (cached) {
    logger.debug(`News cache hit for ${symbol}`);
    return cached;
  }

  try {
    const { headlines, sources } = await gatherHeadlines(symbol, companyName);

    const autoNeg = detectAutoNegative(headlines);
    let result;
    if (autoNeg) {
      result = {
        headlines,
        sources,
        sentiment: SENTIMENTS.NEGATIVE,
        sentimentScore: NEWS_AUTO_NEGATIVE_SCORE,
        autoNegative: true,
        reason: `Auto-negative keyword "${autoNeg.keyword}": ${autoNeg.headline}`,
      };
    } else if (!headlines.length) {
      result = {
        headlines,
        sources,
        sentiment: SENTIMENTS.NEUTRAL,
        sentimentScore: 0,
        autoNegative: false,
        reason: null,
      };
    } else {
      const scored = NEWS_USE_CLAUDE_SENTIMENT
        ? await scoreHeadlinesClaude(headlines, symbol)
        : scoreHeadlinesKeyword(headlines);
      result = { headlines, sources, ...scored, autoNegative: false, reason: null };
    }

    result.headlines = result.headlines.slice(0, NEWS_MAX_HEADLINES);
    logger.info(`News fetched for ${symbol}`, {
      sentiment: result.sentiment,
      score: result.sentimentScore,
      headlines: result.headlines.length,
      sources,
    });
    await persistCache(symbol, result);
    return result;
  } catch (err) {
    logger.warn(`News fetch failed for ${symbol} — defaulting to NEUTRAL`, { error: err.message });
    return {
      headlines: [],
      sources: [],
      sentiment: SENTIMENTS.NEUTRAL,
      sentimentScore: 0,
      autoNegative: false,
      reason: null,
    };
  }
};

/**
 * Backward-compatible adapter used by the scanner.
 *
 * @param {string} symbol - NSE symbol
 * @returns {Promise<{ sentiment: string, headlines: string[], score: number }>}
 */
export const fetchNewsAndSentiment = async (symbol) => {
  const r = await fetchNewsForStock(symbol);
  return { sentiment: r.sentiment, headlines: r.headlines, score: r.sentimentScore };
};

/** Clear the in-memory news cache (useful for tests). */
export const clearNewsCache = () => memCache.clear();
