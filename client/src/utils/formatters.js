/**
 * @file formatters.js
 * @description Currency, percentage, date, and number formatting utilities
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

/**
 * Format a number as Indian Rupee currency
 * @param {number} value
 * @param {number} [decimals=2]
 * @returns {string}
 */
export const formatCurrency = (value, decimals = 2) => {
  if (value == null || isNaN(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

/**
 * Format a decimal as a percentage string
 * @param {number} value - e.g. 0.152 or 15.2
 * @param {boolean} [isDecimal=false] - true if value is 0-1 range
 * @returns {string}
 */
export const formatPercent = (value, isDecimal = false) => {
  if (value == null || isNaN(value)) return '—';
  const pct = isDecimal ? value * 100 : value;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
};

/**
 * Format a Date or ISO string to readable IST time
 * @param {Date|string} date
 * @returns {string}
 */
export const formatDateTime = (date) => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
};

/**
 * Return how many minutes ago a timestamp was
 * @param {Date|string} date
 * @returns {string}
 */
export const timeAgo = (date) => {
  if (!date) return '—';
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  return `${diffHrs}h ${diffMins % 60}m ago`;
};

/**
 * Format large numbers with Indian lakh/crore notation
 * @param {number} value
 * @returns {string}
 */
export const formatIndianNumber = (value) => {
  if (value == null || isNaN(value)) return '—';
  if (value >= 10000000) return `${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(2)} L`;
  return value.toLocaleString('en-IN');
};
