from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest
from strategies.ict_strategy import ICTStrategy
import time

candles_1m = load_candles("data/2023gj.csv")
candles_5m = resample_candles(candles_1m, period=5)

strategy = ICTStrategy(
    session="london",
    lookback=7,
    ob_max_age=50,
    atr_mult=2.5,
    use_liquidity_sweep=True,
    sweep_lookback=5,
)

total_start = time.perf_counter()

for rr in [1.0, 1.5, 2.0, 2.5, 3.0]:
    t0 = time.perf_counter()
    trades = run_backtest(candles_5m, strategy, 10000, risk_reward=rr)
    elapsed = time.perf_counter() - t0
    if not trades:
        print(f"RR={rr}: No trades ({elapsed:.2f}s)")
        continue
    total_pnl = sum(t.pnl for t in trades)
    winners = [t for t in trades if t.pnl > 0]
    losers = [t for t in trades if t.pnl <= 0]
    wr = len(winners) / len(trades) * 100
    avg_win = sum(t.pnl for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t.pnl for t in losers) / len(losers) if losers else 0

    print(
        f"RR={rr}: Trades={len(trades)}, WR={wr:.1f}%, PnL={total_pnl:.2f}, "
        f"AvgW={avg_win:.3f}, AvgL={avg_loss:.3f}, Time={elapsed:.2f}s"
    )

total_elapsed = time.perf_counter() - total_start
print(f"Total run time: {total_elapsed:.2f}s")
