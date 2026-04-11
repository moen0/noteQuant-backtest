class CategoricalStrategy:
    def __init__(self, lookback=20, range_threshold=0.4, atr_multiplier=0.5):
        self.lookback = lookback
        self.range_threshold = range_threshold
        self.atr_multiplier = atr_multiplier

    def get_atr1(self, candle):
        return candle.high - candle.low

    def classify(self, history):
        if len(history) < self.lookback:
            return None

        window = history[-self.lookback:]
        highest = max(c.high for c in window)
        lowest = min(c.low for c in window)
        full_range = highest - lowest

        # Check how much of the range was used early vs late
        first_half = window[:len(window) // 2]
        second_half = window[len(window) // 2:]

        first_high = max(c.high for c in first_half)
        first_low = min(c.low for c in first_half)
        second_high = max(c.high for c in second_half)
        second_low = min(c.low for c in second_half)

        # If second half is expanding beyond first half range, it's direction
        expansion = 0
        if second_high > first_high:
            expansion += second_high - first_high
        if second_low < first_low:
            expansion += first_low - second_low

        avg_candle = sum(self.get_atr1(c) for c in window) / len(window)

        if expansion > avg_candle * self.range_threshold:
            return "direction"
        return "consolidation"

    def check_signal(self, history):
        if len(history) < self.lookback + 1:
            return None

        category = self.classify(history)
        if category is None:
            return None

        window = history[-self.lookback:]
        highest = max(c.high for c in window)
        lowest = min(c.low for c in window)
        mid = (highest + lowest) / 2
        candle = history[-1]
        prev = history[-2]

        atr = self.get_atr1(candle)
        bracket = atr * self.atr_multiplier

        if category == "consolidation":
            # Near top of range and candle turning down: sell
            if candle.close > mid and candle.close < prev.close:
                return "SELL"
            # Near bottom of range and candle turning up: buy
            if candle.close < mid and candle.close > prev.close:
                return "BUY"

        elif category == "direction":
            # Price pushing up: follow
            if candle.close > prev.close and candle.close > mid:
                return "BUY"
            # Price pushing down: follow
            if candle.close < prev.close and candle.close < mid:
                return "SELL"

        return None