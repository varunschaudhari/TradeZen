import sys
sys.path.insert(0, '/users/varun.chaudhari/my-projects/tradezen/python-service')

from app.services.screener import screen_universe

# Run the screener with the watchlist stocks
result = screen_universe(
    tiers=('NIFTY50', 'NEXT50', 'MIDCAP150', 'SMALLCAP100'),
    check_earnings=True,
    extra_symbols=['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK']
)

print('📊 SCREENING RESULTS:\n')
print(f'Universe size: {result.universeCount}')
print(f'Candidates surviving: {result.candidateCount}')
print(f'\n❌ REJECTIONS BY STAGE:')
for stage, count in result.rejectionCounts.items():
    pct = (count / result.universeCount * 100) if result.universeCount > 0 else 0
    print(f'  {stage}: {count} ({pct:.1f}%)')

print(f'\n✅ TOP 10 SURVIVORS (by momentum/ROC):')
for i, cand in enumerate(result.candidates[:10], 1):
    print(f'  {i}. {cand.symbol} | ROC: {cand.rocPct:.2f}% | RSI: {cand.rsi14:.1f} | ATR%: {cand.atrPct:.2f}% | Price: ₹{cand.currentPrice:.2f}')
