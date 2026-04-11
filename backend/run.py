from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest
from strategies.ict_strategy import ICTStrategy
import time

# Load data
candles_1m = load_candles("data/data1.csv")
candles_5m = resample_candles(candles_1m, period=5)

print("Testing different Risk-Reward ratios with optimized ICTStrategy...\n")

# Best params from optimization (you can tweak session/lookback etc. if you want)
strategy = ICTStrategy(
    session="new_york",          # Best was New York
    lookback=7,
    ob_max_age=20,               # Best was 20
    atr_mult=2.5,
    use_liquidity_sweep=False,   # Best was False
    sweep_lookback=5,
)

for rr in [1.0, 1.5, 2.0, 2.5, 3.0]:
    t0 = time.perf_counter()

    trades = run_backtest(candles_5m, strategy, 10000, risk_reward=rr)

    elapsed = time.perf_counter() - t0

    if not trades:
        print(f"RR={rr}: No trades")
        continue

    total_pnl = sum(t.pnl for t in trades)
    winners = [t for t in trades if t.pnl > 0]
    losers = [t for t in trades if t.pnl <= 0]

    wr = len(winners) / len(trades) * 100 if trades else 0
    avg_win = sum(t.pnl for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t.pnl for t in losers) / len(losers) if losers else 0
    profit_factor = abs(sum(t.pnl for t in winners) / sum(t.pnl for t in losers)) if losers else float('inf')

    print(f"RR={rr:4.1f} | Trades={len(trades):4d} | WR={wr:5.1f}% | "
          f"PnL={total_pnl:8.2f} | AvgWin={avg_win:6.3f} | AvgLoss={avg_loss:6.3f} | "
          f"PF={profit_factor:5.2f} | Time={elapsed:.3f}s")