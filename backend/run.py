from data.loader import load_candles
from indicators.market_structure import find_swing_points, detect_structure

candles = load_candles("data/data.csv")
print(f"Loaded {len(candles)} candles")

swings = find_swing_points(candles)
structure = detect_structure(swings)
print(f"Structure points: {len(structure)}")

for s in structure[:10]:
    print(s)