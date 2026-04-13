def find_fvgs(candles, min_gap_size=0.0, impulse_multiplier=0.0):
    fvgs = []

    avg_body = 0
    if impulse_multiplier > 0 and len(candles) > 20:
        bodies = [abs(c.close - c.open) for c in candles[:20]]
        avg_body = sum(bodies) / len(bodies)

    for i in range(2, len(candles)):
        c1 = candles[i - 2]
        c2 = candles[i - 1]
        c3 = candles[i]

        # Impulse check on middle candle
        if impulse_multiplier > 0 and avg_body > 0:
            middle_body = abs(c2.close - c2.open)
            if middle_body < avg_body * impulse_multiplier:
                continue
            # Update rolling average
            avg_body = (avg_body * 19 + middle_body) / 20

        # Bullish FVG
        if c1.high < c3.low:
            gap_size = c3.low - c1.high
            if gap_size >= min_gap_size:
                fvgs.append({
                    "index": i - 1,
                    "type": "bullish",
                    "top": c3.low,
                    "bottom": c1.high,
                    "mitigated": False,
                })

        # Bearish FVG
        elif c1.low > c3.high:
            gap_size = c1.low - c3.high
            if gap_size >= min_gap_size:
                fvgs.append({
                    "index": i - 1,
                    "type": "bearish",
                    "top": c1.low,
                    "bottom": c3.high,
                    "mitigated": False,
                })
        # Mark mitigated FVGs
        for fvg in fvgs:
            if fvg["mitigated"]:
                continue
            if fvg["type"] == "bullish":
                if c3.low <= fvg["bottom"]:
                    fvg["mitigated"] = True
            elif fvg["type"] == "bearish":
                if c3.high >= fvg["top"]:
                    fvg["mitigated"] = True

    return fvgs
