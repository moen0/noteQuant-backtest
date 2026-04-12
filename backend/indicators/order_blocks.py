def find_order_blocks(candles, structure, min_impulse=0.10, min_ob_size=0.0):
    """
    Find Order Blocks based on structure breaks.

    Args:
        candles: list of Candle objects
        structure: list of structure points from detect_structure
        min_impulse: legacy param (unused, kept for compat)
        min_ob_size: minimum OB size in price units (0 = no filter)
    """
    obs = []

    for point in structure:
        if point["label"] == "HH":
            idx = point["index"]
            for j in range(idx - 1, max(idx - 20, 0), -1):
                if candles[j].close < candles[j].open:
                    size = candles[j].open - candles[j].close
                    if size >= min_ob_size:
                        obs.append({
                            "index": j,
                            "type": "bullish",
                            "top": candles[j].open,
                            "bottom": candles[j].close,
                        })
                    break

        elif point["label"] == "LL":
            idx = point["index"]
            for j in range(idx - 1, max(idx - 20, 0), -1):
                if candles[j].close > candles[j].open:
                    size = candles[j].close - candles[j].open
                    if size >= min_ob_size:
                        obs.append({
                            "index": j,
                            "type": "bearish",
                            "top": candles[j].close,
                            "bottom": candles[j].open,
                        })
                    break

    return obs
