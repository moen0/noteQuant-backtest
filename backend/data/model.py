from dataclasses import dataclass
from datetime import datetime

@dataclass
class Candle:
    time_open: datetime
    open: float
    high: float
    low: float
    close: datetime
    volume: float

@dataclass
class Trade:
    enter_time: datetime
    enter_price: float
    direction: str
    exit_time:datetime
    exit_price: float
    pnl: float
