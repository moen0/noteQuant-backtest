from data.model import Candle, Trade
from strategies.base import SimpleStrategy

def run_backtest(
        candles: list[Candle],
        strategy,
        starting_balance: float = 10000.0,
        risk_reward: float = 1.0
) -> list[Trade]:
    """
    Runs a backtest on a list of candles using the provided strategy.
    Returns a list of closed Trades.
    """
    trades = []
    position = None

    # One-time preparation (e.g. pre-compute indicators)
    if hasattr(strategy, "prepare"):
        strategy.prepare(candles)

    for i, candle in enumerate(candles):
        # === 1. Check if we have an open position (SL/TP hit) ===
        if position is not None:
            hit_sl = False
            hit_tp = False
            exit_price = None

            if position["direction"] == "long":
                if candle.low <= position["stop_loss"]:
                    hit_sl = True
                    exit_price = position["stop_loss"]
                elif candle.high >= position["take_profit"]:
                    hit_tp = True
                    exit_price = position["take_profit"]
            else:  # short
                if candle.high >= position["stop_loss"]:
                    hit_sl = True
                    exit_price = position["stop_loss"]
                elif candle.low <= position["take_profit"]:
                    hit_tp = True
                    exit_price = position["take_profit"]

            if hit_sl or hit_tp:
                # Calculate PnL
                if position["direction"] == "long":
                    pnl = exit_price - position["entry_price"]
                else:  # short
                    pnl = position["entry_price"] - exit_price

                trade = Trade(
                    enter_time=position["enter_time"],
                    enter_price=position["entry_price"],
                    direction=position["direction"],
                    exit_time=candle.time_open,
                    exit_price=exit_price,
                    pnl=pnl
                )
                trades.append(trade)
                position = None

        # === 2. Look for new entry signal only if flat ===
        if position is None:
            signal = strategy.check_signal(candles, i)   # Fixed: pass index instead of slicing

            if signal == "BUY":
                atr = candle.high - candle.low
                mult = getattr(strategy, "atr_mult", 0.5)
                bracket = atr * mult

                position = {
                    "direction": "long",
                    "entry_price": candle.close,
                    "enter_time": candle.time_open,
                    "stop_loss": candle.close - bracket,
                    "take_profit": candle.close + (bracket * risk_reward),
                }

            elif signal == "SELL":
                atr = candle.high - candle.low
                mult = getattr(strategy, "atr_mult", 0.5)
                bracket = atr * mult

                position = {
                    "direction": "short",
                    "entry_price": candle.close,
                    "enter_time": candle.time_open,
                    "stop_loss": candle.close + bracket,
                    "take_profit": candle.close - (bracket * risk_reward),
                }

    return trades