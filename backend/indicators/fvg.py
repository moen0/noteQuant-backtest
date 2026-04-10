def find_fvgs(candles):
    fvgs = []

    for i in range(2, len(candles)):
        c1 = candles[i - 2]
        c2 = candles[i - 1]
        c3 = candles[i]

        # Bullish
        if c1.high < c3.low:
            fvgs.append({
                "index": i - 1,
                "type": "bullish",
                "top": c3.low,
                "bottom": c1.high
            })

        # bearish
        elif c1.low > c3.high:
            fvgs.append({
                "index": i - 1,
                "type": "bearish",
                "top": c1.low,
                "bottom": c3.high
            })

    return fvgs