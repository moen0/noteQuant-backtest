from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest
from strategies.ict_strategy import ICTStrategy
import time
from tqdm import tqdm
from joblib import Parallel, delayed

print("Loading data...")
candles_1m = load_candles("data/data1.csv")
candles_5m = resample_candles(candles_1m, period=5)
print(f"Loaded {len(candles_5m):,} 5-minute candles.\n")

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

print(f"Starting parallel optimization of {len(param_combos)} combinations...\n")

def run_one_combo(params):
    strategy = ICTStrategy(
        session=params["session"],
        lookback=params["lookback"],
        ob_max_age=params["ob_age"],
        atr_mult=params["atr"],
        use_liquidity_sweep=params["sweep"],
        sweep_lookback=params["sweep_lb"],
    )

    t0 = time.perf_counter()
    trades = run_backtest(candles_5m, strategy, 10000)
    elapsed = time.perf_counter() - t0

    if len(trades) < 5:
        return None

    total_pnl = sum(t.pnl for t in trades)
    wr = len([t for t in trades if t.pnl > 0]) / len(trades) * 100 if trades else 0.0

    return {
        "params": params,
        "pnl": total_pnl,
        "trades": len(trades),
        "wr": round(wr, 2),
        "time": round(elapsed, 4)
    }

total_start = time.perf_counter()

results = Parallel(n_jobs=-1, verbose=10)(
    delayed(run_one_combo)(params) for params in param_combos
)

valid_results = [r for r in results if r is not None]

if not valid_results:
    print("No valid strategies found with at least 5 trades.")
    exit()

best_result = max(valid_results, key=lambda x: x["pnl"])

total_time = time.perf_counter() - total_start

print("\n" + "="*70)
print("PARALLEL OPTIMIZATION FINISHED!")
print(f"Total time on M4 Mac: {total_time:.1f} seconds ({total_time/60:.1f} minutes)")
print(f"Processed {len(param_combos)} combinations at ~{len(param_combos)/total_time:.2f} combos/second")
print(f"Best PnL: {best_result['pnl']:.2f}")
print(f"Best Params: {best_result['params']}")
print(f"Trades: {best_result['trades']} | Win Rate: {best_result['wr']}%")
print("="*70)

print("\nTop 5 results:")
for res in sorted(valid_results, key=lambda x: x["pnl"], reverse=True)[:5]:
    print(f"PnL: {res['pnl']:.2f} | Trades: {res['trades']} | WR: {res['wr']}% | {res['params']}")