from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest
from strategies.categorical_strategy import CategoricalStrategy

candles_1m = load_candles("data/data.csv")
candles_5m = resample_candles(candles_1m, period=5)

best_pnl = float("-inf")
best_params = None

for lookback in [10, 15, 20, 30, 40, 50]:
    for threshold in [0.2, 0.3, 0.4, 0.5, 0.7, 1.0]:
        for atr_mult in [0.3, 0.4, 0.5, 0.6, 0.7]:
            strategy = CategoricalStrategy(
                lookback=lookback,
                range_threshold=threshold,
                atr_multiplier=atr_mult
            )
            trades = run_backtest(candles_5m, strategy, 10000)
            if len(trades) < 50:
                continue
            total_pnl = sum(t.pnl for t in trades)
            win_rate = len([t for t in trades if t.pnl > 0]) / len(trades) * 100
            if total_pnl > best_pnl:
                best_pnl = total_pnl
                best_params = (lookback, threshold, atr_mult)
                print(f"New best: LB={lookback}, TH={threshold}, ATR={atr_mult} -> PnL={total_pnl:.2f}, WR={win_rate:.1f}%, Trades={len(trades)}")

print(f"\nBest: lookback={best_params[0]}, threshold={best_params[1]}, atr_mult={best_params[2]}, PnL={best_pnl:.2f}")