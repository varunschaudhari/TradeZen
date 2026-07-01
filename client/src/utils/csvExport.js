/**
 * csvExport.js — lightweight CSV download helper (no dependencies).
 * Usage:
 *   downloadCSV('trades.csv', rows, ['Symbol', 'Entry', 'P&L'])
 */

function escape(value) {
  const s = String(value ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/**
 * @param {string}   filename  — downloaded file name (include .csv)
 * @param {Array[]}  rows      — 2-D array of values (already ordered)
 * @param {string[]} headers   — column header row
 */
export function downloadCSV(filename, rows, headers) {
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Format a JS Date or ISO string as DD-MMM-YYYY for CSV cells */
export function fmtDateCSV(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(dt.getDate()).padStart(2,'0')}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
}
