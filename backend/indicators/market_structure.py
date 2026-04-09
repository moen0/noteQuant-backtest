def find_swing_points(candles, lookback=5):
    swings = []

    for i in range(lookback, len(candles) - lookback):
        high = candles[i].high
        low = candles[i].low
        #check if higher
        is_swing_high = all(
            high > candles[i + j].high
            for j in range(-lookback, lookback + 1)
            if j != 0
        )

        # check if lower
        is_swing_low = all(
            low < candles[i + j].low
            for j in range(-lookback, lookback + 1)
            if j != 0
        )

        if is_swing_high:
            swings.append({"index": i, "price": high, "type": "high"})
        if is_swing_low:
            swings.append({"index": i, "price": low, "type": "low"})

    return swings

def detect_structure(swings):
    last_high = None
    last_low = None
    structure = []

    for swing in swings:
        if swing["type"] == "high":
            if last_high is not None:
                if swing["price"] > last_high["price"]:
                    label = "HH"
                else:
                    label = "LH"
                structure.append({**swing, "label": label})
            last_high = swing

        elif swing["type"] == "low":
            if last_low is not None:
                if swing["price"] > last_low["price"]:
                    label = "HL"
                else:
                    label = "LL"
                structure.append({**swing, "label": label})
            last_low = swing

    return structure