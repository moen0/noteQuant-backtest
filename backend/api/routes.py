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

@app.get("/api/backtest")
def get_backtest(timeframe: int = 5, rr: float = 2.5):
    candles_1m = load_candles("data/data.csv")
    candles = resample_candles(candles_1m, period=timeframe)

    from strategies.ict_strategy import ICTStrategy
    strategy = ICTStrategy(
        session="london",
        lookback=7,
        ob_max_age=50,
        atr_mult=2.5,
        use_liquidity_sweep=True,
        sweep_lookback=5,
    )
    from engine.backtester import run_backtest
    trades = run_backtest(candles, strategy, 10000, risk_reward=rr)

    candle_times = [c.time_open.isoformat() for c in candles]

    trades_data = []
    for t in trades:
        trades_data.append({
            "enter_time": t.enter_time.isoformat(),
            "exit_time": t.exit_time.isoformat(),
            "enter_price": t.enter_price,
            "exit_price": t.exit_price,
            "direction": t.direction,
            "pnl": t.pnl,
        })

    total_pnl = sum(t.pnl for t in trades)
    winners = [t for t in trades if t.pnl > 0]
    losers = [t for t in trades if t.pnl <= 0]

    return {
        "trades": trades_data,
        "candle_times": candle_times,
        "stats": {
            "total_trades": len(trades),
            "winners": len(winners),
            "losers": len(losers),
            "win_rate": len(winners) / len(trades) * 100 if trades else 0,
            "total_pnl": total_pnl,
            "avg_win": sum(t.pnl for t in winners) / len(winners) if winners else 0,
            "avg_loss": sum(t.pnl for t in losers) / len(losers) if losers else 0,
            "risk_reward": rr,
        }
    }