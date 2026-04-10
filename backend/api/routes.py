from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from data.loader import load_candles, resample_candles
from indicators.market_structure import find_swing_points, detect_structure
from indicators.liquidity import find_liquidity_levels
from indicators.fvg import find_fvgs
from indicators.order_blocks import find_order_blocks
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/candles")
def get_candles(timeframe: int = 5):
    candles_1m = load_candles("data/data.csv")
    candles = resample_candles(candles_1m, period=timeframe)

    return {
        "candles": [
            {
                "time": c.time_open.isoformat(),
                "open": c.open,
                "high": c.high,
                "low": c.low,
                "close": c.close
            }
            for c in candles
        ]
    }
@app.get("/api/indicators")
def get_indicators(timeframe: int = 5):
    candles_1m = load_candles("data/data.csv")
    candles = resample_candles(candles_1m, period=timeframe)

    swings = find_swing_points(candles)
    structure = detect_structure(swings)
    levels = find_liquidity_levels(swings)
    fvgs = find_fvgs(candles)
    obs = find_order_blocks(candles, structure)

    candle_times = [c.time_open.isoformat() for c in candles]

    return {
        "candle_times": candle_times,
        "swings": swings,
        "structure": structure,
        "liquidity": levels,
        "fvgs": fvgs,
        "order_blocks": obs
    }