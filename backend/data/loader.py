print("File is running")
import pandas as pd
from data.model import Candle

def load_candles(filepath: str) -> list[Candle]:
    df = pd.read_csv(filepath, sep=";", header=None, names=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="%Y%m%d %H%M%S")

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

if __name__ == "__main__":
    candles = load_candles("data.csv")
    print(f"Loaded {len(candles)} candles")
    print(f"First: {candles[0]}")
    print(f"Last: {candles[-1]}")
