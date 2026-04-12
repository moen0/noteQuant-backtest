print("File is running")
import pandas as pd
from data.model import Candle

def load_candles(filepath: str) -> list[Candle]:
    df = pd.read_csv(filepath, sep=";", header=None, names=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="%Y%m%d %H%M%S")
    df = df.sort_values("timestamp", kind="mergesort").drop_duplicates(subset=["timestamp"], keep="last")

    candles = []
    for _, row in df.iterrows():
        candle = Candle(
            time_open=row["timestamp"],
            open=row["open"],
            high=row["high"],
            low=row["low"],
            close=row["close"],
            volume=row["volume"]
        )
        candles.append(candle)

    return candles

def resample_candles(candles, period=5):
    resampled = []
    for i in range(0, len(candles) - period + 1, period):
        group = candles[i:i + period]
        resampled.append(Candle(
            time_open=group[0].time_open,
            open=group[0].open,
            high=max(c.high for c in group),
            low=min(c.low for c in group),
            close=group[-1].close,
            volume=sum(c.volume for c in group)
        ))
    return resampled