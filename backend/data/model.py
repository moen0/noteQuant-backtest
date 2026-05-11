from dataclasses import dataclass
from datetime import datetime


@dataclass
class Candle:
    time_open: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Signal:
    direction: str
    stop_loss: float
    entry_price: float


@dataclass
class Trade:
    enter_time: datetime
    enter_price: float
    direction: str
    exit_time: datetime
    exit_price: float
    pnl: float
    r_multiple: float = 0.0
    partial_tp_taken: bool = False
    partial_tp_realized_pnl: float = 0.0
