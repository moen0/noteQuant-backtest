from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest
from strategies.ict_strategy import ICTStrategy
import time
from tqdm import tqdm

# Load data once
candles_1m = load_candles("data/data1.csv")
candles_5m = resample_candles(candles_1m, period=5)

# Initialize best results
best_pnl = float("-inf")
best_params = None

# Generate all parameter combinations
param_combos = []
for session in ["london", "new_york"]:
    for lookback in [3, 5, 7, 10]:
        for ob_age in [20, 50, 80]:
            for atr in [1.0, 1.5, 2.0, 2.5]:
                for sweep in [True, False]:
                    sweep_lbs = [5, 10, 15] if sweep else [0]
                    for sweep_lb in sweep_lbs:
                        param_combos.append({
                            "session": session,
                            "lookback": lookback,
                            "ob_age": ob_age,
                            "atr": atr,
                            "sweep": sweep,
                            "sweep_lb": sweep_lb
                        })

print(f"Starting optimization of {len(param_combos)} combinations on your M4 Mac...\n")

total_start = time.perf_counter()

# Main loop with progress bar
for params in tqdm(param_combos, desc="Optimizing ICT Strategy", unit="backtest"):
    strategy = ICTStrategy(
        session=params["session"],
        lookback=params["lookback"],
        ob_max_age=params["ob_age"],
        atr_mult=params["atr"],
        use_liquidity_sweep=params["sweep"],
        sweep_lookback=params["sweep_lb"],
    )

    # Accurate timing
    t0 = time.perf_counter()
    trades = run_backtest(candles_5m, strategy, 10000)
    elapsed = time.perf_counter() - t0

    # Optional: print every backtest (can be noisy, comment out if you want cleaner output)
    # print(f"Backtest took {elapsed:.4f}s | Trades: {len(trades)}")

    if len(trades) < 5:
        continue

    total_pnl = sum(t.pnl for t in trades)
    wr = len([t for t in trades if t.pnl > 0]) / len(trades) * 100 if trades else 0.0

    if total_pnl > best_pnl:
        best_pnl = total_pnl
        best_params = {
            "session": params["session"],
            "lookback": params["lookback"],
            "ob_age": params["ob_age"],
            "atr": params["atr"],
            "sweep": params["sweep"],
            "sweep_lb": params["sweep_lb"],
            "trades": len(trades),
            "wr": round(wr, 2)
        }
        tqdm.write(f"New best! PnL = {total_pnl:.2f} | Params: {best_params}")

# Final results
total_time = time.perf_counter() - total_start

print("\n" + "="*60)
print("Optimization finished!")
print(f"Total time on your M4: {total_time:.1f} seconds ({total_time/60:.1f} minutes)")
print(f"Best params: {best_params}")
print(f"Best PnL: {best_pnl:.2f}")
print("="*60)