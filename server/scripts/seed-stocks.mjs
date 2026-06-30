/**
 * @file seed-stocks.mjs
 * @description One-time seed of the Stock master collection. Fetches the full NSE
 *   universe, then pulls each symbol's /stock detail (sector + fundamentals) with
 *   bounded concurrency and upserts it. Safe to re-run (idempotent upserts).
 *
 * Usage (inside the server container so it has DB + Python access):
 *   docker compose exec server node scripts/seed-stocks.mjs
 *   CONCURRENCY=8 node scripts/seed-stocks.mjs
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Stock from '../src/models/Stock.js';
import { fetchUniverse, fetchStockDetail } from '../src/services/pythonBridge.js';
import { upsertStockDetail } from '../src/services/stockMaster.js';

// Low default concurrency: each /stock call pulls yfinance fundamentals (slow), and the
// single Python service is easily overwhelmed — keep in-flight calls small and gentle.
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '2', 10);
// Skip stocks whose fundamentals were refreshed within this window (makes re-runs resumable).
const FRESH_HOURS = parseInt(process.env.FRESH_HOURS ?? '12', 10);

async function runBounded(items, limit, fn) {
  let cursor = 0;
  let done = 0;
  const total = items.length;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await fn(items[idx]);
      done += 1;
      if (done % 25 === 0 || done === total) {
        console.log(`  …${done}/${total} processed`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  await connectDB();
  console.log('Fetching NSE universe…');
  const symbols = await fetchUniverse();
  if (!symbols.length) {
    console.error('Universe is empty — is the Python service reachable?');
    process.exit(1);
  }
  // Resumable: skip symbols already refreshed within FRESH_HOURS so a re-run only fills gaps.
  const freshCutoff = new Date(Date.now() - FRESH_HOURS * 3600 * 1000);
  const alreadyFresh = await Stock.find({ fundamentalsRefreshedAt: { $gte: freshCutoff } })
    .select('symbol')
    .lean();
  const skip = new Set(alreadyFresh.map((s) => s.symbol));
  const todo = symbols.filter((s) => !skip.has(s));
  console.log(
    `${skip.size} already fresh (skipping) · ${todo.length} to fetch (concurrency ${CONCURRENCY})…`
  );

  let ok = 0;
  let failed = 0;
  await runBounded(todo, CONCURRENCY, async (symbol) => {
    try {
      const detail = await fetchStockDetail(symbol);
      if (detail && !detail.error) {
        await upsertStockDetail(detail);
        ok += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1; // one bad symbol must not abort the seed
    }
  });

  console.log(
    `\nSeed complete: ${ok} upserted, ${failed} failed of ${todo.length} attempted ` +
      `(${skip.size} already fresh, ${symbols.length} in universe).`
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
