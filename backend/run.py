from data.loader import load_candles
from engine.backtester import run_backtest

candles = load_candles("data/data.csv")
print(f"Loaded {len(candles)} candles")

trades = run_backtest(candles, starting_balance=10000.0)
print(f"Completed {len(trades)} trades")

for trade in trades[:5]:
    print(trade)