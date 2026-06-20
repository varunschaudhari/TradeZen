/**
 * @file NewsWidget.jsx
 * @description News headlines + sentiment badge.
 *
 *  API shape (after axios interceptor unwraps): response.data =
 *    { sentiment: 'POSITIVE'|'NEUTRAL'|'NEGATIVE', headlines: string[], score: number }
 *
 *  Headlines are plain strings — no URL or date from Google News RSS.
 */

import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { newsApi } from '../services/api.js';
import { SENTIMENTS } from '../utils/constants.js';

const SENTIMENT_STYLES = {
  [SENTIMENTS.POSITIVE]: 'bg-bull/20 text-bull border-bull/30',
  [SENTIMENTS.NEUTRAL]:  'bg-slate-700 text-slate-300 border-slate-600',
  [SENTIMENTS.NEGATIVE]: 'bg-bear/20 text-bear border-bear/30',
};

const SENTIMENT_ICONS = {
  [SENTIMENTS.POSITIVE]: '↑',
  [SENTIMENTS.NEUTRAL]:  '—',
  [SENTIMENTS.NEGATIVE]: '↓',
};

const NewsWidget = ({ symbol }) => {
  const [newsData, setNewsData] = useState(null);  // { sentiment, headlines, score }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchNews = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await newsApi.getBySymbol(symbol);
      /* res = { success, data: { sentiment, headlines, score }, message } */
      setNewsData(res.data ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const sentimentStyle = SENTIMENT_STYLES[newsData?.sentiment] ?? SENTIMENT_STYLES[SENTIMENTS.NEUTRAL];
  const sentimentIcon  = SENTIMENT_ICONS[newsData?.sentiment] ?? '—';

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-200">
          News — <span className="font-mono">{symbol}</span>
        </h3>
        {newsData?.sentiment && (
          <span className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${sentimentStyle}`}>
            <span>{sentimentIcon}</span>
            {newsData.sentiment}
          </span>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-slate-700 rounded animate-pulse" style={{ width: `${75 + i * 7}%` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p className="text-bear text-xs">{error}</p>
      )}

      {/* Empty */}
      {!loading && !error && !newsData?.headlines?.length && (
        <p className="text-slate-500 text-xs">No recent headlines found for {symbol}.</p>
      )}

      {/* Headlines list */}
      {!loading && newsData?.headlines?.length > 0 && (
        <ul className="space-y-2">
          {newsData.headlines.map((headline, idx) => (
            <li
              key={idx}
              className="border-b border-slate-700/60 pb-2 last:border-0 last:pb-0"
            >
              <p className="text-xs text-slate-300 leading-snug">{headline}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Score footer */}
      {!loading && newsData != null && (
        <div className="mt-3 pt-2 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <span>Sentiment score: {newsData.score > 0 ? '+' : ''}{newsData.score}</span>
          <button
            onClick={fetchNews}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      )}
    </div>
  );
};

NewsWidget.propTypes = {
  symbol: PropTypes.string.isRequired,
};

export default NewsWidget;
