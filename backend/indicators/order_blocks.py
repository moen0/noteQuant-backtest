def find_order_blocks(candles, structure, min_impulse=0.10):
    obs = []

    for point in structure:
        if point["label"] == "HH":
            # Bullish break of structure, look back for last bearish candle
            idx = point["index"]
            for j in range(idx - 1, max(idx - 20, 0), -1):
                if candles[j].close < candles[j].open:
                    obs.append({
                        "index": j,
                        "type": "bullish",
                        "top": candles[j].open,
                        "bottom": candles[j].close
                    })
                    break

        elif point["label"] == "LL":
            # Bearish break of structure, look back for last bullish candle
            idx = point["index"]
            for j in range(idx - 1, max(idx - 20, 0), -1):
                if candles[j].close > candles[j].open:
                    obs.append({
                        "index": j,
                        "type": "bearish",
                        "top": candles[j].close,
                        "bottom": candles[j].open
                    })
                    break

    return obs