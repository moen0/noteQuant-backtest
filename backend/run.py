from data.loader import load_candles, resample_candles
from indicators.market_structure import find_swing_points, detect_structure
from indicators.liquidity import find_liquidity_levels
from indicators.fvg import find_fvgs
from indicators.order_blocks import find_order_blocks

candles_1m = load_candles("data/data.csv")
candles_3m = resample_candles(candles_1m, period=3)
candles_5m = resample_candles(candles_1m, period=5)

print(f"1m: {len(candles_1m)} candles")
print(f"3m: {len(candles_3m)} candles")
print(f"5m: {len(candles_5m)} candles")

swings = find_swing_points(candles_5m)
structure = detect_structure(swings)
levels = find_liquidity_levels(swings)
fvgs = find_fvgs(candles_5m)
obs = find_order_blocks(candles_5m, structure)

print(f"Swing points: {len(swings)}")
print(f"Structure points: {len(structure)}")
print(f"Liquidity levels: {len(levels)}")
print(f"FVGs: {len(fvgs)}")
print(f"Order blocks: {len(obs)}")

for o in obs[:5]:
    print(o)