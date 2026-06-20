/**
 * @file tailwind.config.js
 * @description Tailwind config with trading-specific color palette
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        buy: { light: '#dcfce7', DEFAULT: '#22c55e', dark: '#15803d' },
        wait: { light: '#fef9c3', DEFAULT: '#eab308', dark: '#a16207' },
        skip: { light: '#fee2e2', DEFAULT: '#ef4444', dark: '#b91c1c' },
        bull: '#22c55e',
        bear: '#ef4444',
        surface: { DEFAULT: '#0f172a', card: '#1e293b', elevated: '#334155' },
      },
      fontFamily: { mono: ['JetBrains Mono', 'Fira Code', 'monospace'] },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
    },
  },
  plugins: [],
};
