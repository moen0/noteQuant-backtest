from data.model import Candle, Trade
from strategies.base import SimpleStrategy

# takes a list of Candles and a starting balance, and returns a list of Trades
def run_backtest(candles: list[Candle], starting_balance: float) -> list[Trade]:
    balance = starting_balance
    trades = []
    position = None
    strategy = SimpleStrategy()

    for i, candle in enumerate(candles):
        # pass 'i' or the sliced history to the strategy
        signal = strategy.check_signal(candles[:i+1])
        # If signal and no position, open trade
        if signal == "BUY" and position is None:
            position = {
                "type": "long",
                "entry_price": candle.close,
                "enter_time": candle.time_open
            }

        # If signal and in position, close trade
        elif signal == "SELL" and position is not None:
            trade = Trade(
                enter_time=position["enter_time"],
                enter_price=position["entry_price"],
                direction="long",
                exit_time=candle.time_open,
                exit_price=candle.close,
                pnl=candle.close - position["entry_price"]
            )
            trades.append(trade)
            position = None



    return trades