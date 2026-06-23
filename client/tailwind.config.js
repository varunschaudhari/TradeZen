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
        accent: { light: '#60a5fa', DEFAULT: '#3b82f6', dark: '#1d4ed8' },
        surface: {
          base: '#0b1220',
          DEFAULT: '#0f172a',
          card: '#1e293b',
          elevated: '#334155',
          hover: '#283549',
        },
      },
      fontFamily: { mono: ['JetBrains Mono', 'Fira Code', 'monospace'] },
      boxShadow: {
        tile: '0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 0 rgba(0,0,0,0.2)',
        drawer: '-12px 0 32px -8px rgba(0,0,0,0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-up': 'fadeInUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
