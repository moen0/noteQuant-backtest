class SimpleStrategy:
    def __init__(self, fast_period=10, slow_period=20):
        self.fast_period = fast_period
        self.slow_period = slow_period

    def check_signal(self, history):
        if len(history) < self.slow_period + 1:
            return None

        fast_now = sum(c.close for c in history[-self.fast_period:]) / self.fast_period
        slow_now = sum(c.close for c in history[-self.slow_period:]) / self.slow_period

        fast_prev = sum(c.close for c in history[-self.fast_period-1:-1]) / self.fast_period
        slow_prev = sum(c.close for c in history[-self.slow_period-1:-1]) / self.slow_period

        if fast_prev <= slow_prev and fast_now > slow_now:
            return "BUY"
        elif fast_prev >= slow_prev and fast_now < slow_now:
            return "SELL"

        return None