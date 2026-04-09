from data.loader import load_candles
from indicators.market_structure import find_swing_points, detect_structure
from indicators.liquidity import find_liquidity_levels

candles = load_candles("data/data.csv")
print(f"Loaded {len(candles)} candles")
from data.loader import load_candles, resample_candles

candles_1m = load_candles("data/data.csv")
candles_3m = resample_candles(candles_1m, period=3)
candles_5m = resample_candles(candles_1m, period=5)

print(f"1m: {len(candles_1m)} candles")
print(f"3m: {len(candles_3m)} candles")
print(f"5m: {len(candles_5m)} candles")

swings = find_swing_points(candles_5m)
levels = find_liquidity_levels(swings)
print(f"Swing points: {len(swings)}")
print(f"Liquidity levels: {len(levels)}")
for l in levels[:5]:
    print(l)

