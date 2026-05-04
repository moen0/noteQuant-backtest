from data.model import Signal
from indicators.market_structure import find_swing_points, detect_structure
from indicators.liquidity import find_liquidity_levels
from indicators.fvg import find_fvgs
from indicators.order_blocks import find_order_blocks
from indicators.sessions import in_session, in_day_filter, get_asian_range
from collections import defaultdict


class ICTStrategy:
    def __init__(
            self,
            lookback=5,
            atr_mult=1.5,
            session="new_york",
            use_fvg=True,
            use_ob=True,
            use_liquidity_sweep=True,
            ob_max_age=50,
            proximity_pct=0.3,
            sweep_lookback=10,
            min_gap_size=0.0,
            impulse_multiplier=0.0,
            require_unmitigated_fvg=True,
            require_bos_confluence=False,
            min_ob_size=0.0,
            require_fvg_ob_confluence=False,
            asian_sweep_only=False,
            day_filter=None,
            sl_buffer_pips=0.0005,
            use_break_even=False,
            be_trigger_rr=1.0,
            use_partial_tp=False,
            partial_tp_rr=1.0,
            partial_tp_percent=50.0,
    ):
        self.lookback = lookback
        self.atr_mult = atr_mult
        self.session = session
        self.use_fvg = use_fvg
        self.use_ob = use_ob
        self.use_liquidity_sweep = use_liquidity_sweep
        self.ob_max_age = ob_max_age
        self.proximity_pct = proximity_pct
        self.sweep_lookback = sweep_lookback

        self.min_gap_size = min_gap_size
        self.impulse_multiplier = impulse_multiplier
        self.require_unmitigated_fvg = require_unmitigated_fvg
        self.require_bos_confluence = require_bos_confluence
        self.min_ob_size = min_ob_size
        self.require_fvg_ob_confluence = require_fvg_ob_confluence
        self.asian_sweep_only = asian_sweep_only
        self.day_filter = day_filter
        self.sl_buffer_pips = sl_buffer_pips
        self.use_break_even = use_break_even
        self.be_trigger_rr = be_trigger_rr
        self.use_partial_tp = use_partial_tp
        self.partial_tp_rr = partial_tp_rr
        self.partial_tp_percent = partial_tp_percent

        self.swings = []
        self.structure = []
        self.fvgs = []
        self.order_blocks = []
        self.liquidity_levels = []
        self.asian_ranges = {}

        self.recent_sweep = None
        self.sweep_expiry = 0

    def prepare(self, candles):
        self.swings = find_swing_points(candles, self.lookback)
        self.structure = detect_structure(self.swings)
        self.fvgs = find_fvgs(
            candles,
            min_gap_size=self.min_gap_size,
            impulse_multiplier=self.impulse_multiplier,
        )
        self.order_blocks = find_order_blocks(
            candles,
            self.structure,
            min_ob_size=self.min_ob_size,
        )
        self.liquidity_levels = find_liquidity_levels(self.swings)

        daily = defaultdict(list)
        for c in candles:
            daily[c.time_open.date()].append(c)
        for date, day_candles in daily.items():
            ar = get_asian_range(day_candles)
            if ar:
                self.asian_ranges[date] = ar

    def get_bias(self, index):
        recent = [s for s in self.structure if s["index"] < index]
        if len(recent) < 2:
            return None

        last_two = recent[-2:]
        labels = [s["label"] for s in last_two]

        if "HH" in labels and "HL" in labels:
            return "bullish"
        if "LL" in labels and "LH" in labels:
            return "bearish"
        if labels[-1] in ("HH", "HL"):
            return "bullish"
        if labels[-1] in ("LL", "LH"):
            return "bearish"
        return None

    def _find_swing_sl(self, index, direction, candle):
        """
        Long  -> SL below most recent swing low
        Short -> SL above most recent swing high

        Fallback to atr_mult bracket if no valid swing found.
        """
        target_type = "low" if direction == "BUY" else "high"

        for swing in reversed(self.swings):
            if swing["index"] >= index:
                continue
            if swing["type"] != target_type:
                continue

            if direction == "BUY":
                sl = swing["price"] - self.sl_buffer_pips
                if sl < candle.close:
                    return sl
            else:
                sl = swing["price"] + self.sl_buffer_pips
                if sl > candle.close:
                    return sl

        # Fallback
        bracket = (candle.high - candle.low) * self.atr_mult
        if direction == "BUY":
            return candle.close - bracket
        return candle.close + bracket

    def _has_recent_bos(self, index, direction):
        for s in reversed(self.structure):
            if s["index"] >= index:
                continue
            if s["index"] < index - 20:
                break
            if direction == "bullish" and s["label"] == "HH":
                return True
            if direction == "bearish" and s["label"] == "LL":
                return True
        return False

    def check_liquidity_sweep(self, candle, index):
        today = candle.time_open.date()
        ar = self.asian_ranges.get(today)

        if ar:
            if candle.high > ar["high"] and candle.close < ar["high"]:
                return "swept_high"
            if candle.low < ar["low"] and candle.close > ar["low"]:
                return "swept_low"

        if self.asian_sweep_only:
            return None

        for level in self.liquidity_levels:
            if level["type"] == "equal_highs":
                if candle.high > level["price"] and candle.close < level["price"]:
                    return "swept_high"
            elif level["type"] == "equal_lows":
                if candle.low < level["price"] and candle.close > level["price"]:
                    return "swept_low"

        return None

    def in_ob_zone(self, price, index):
        for ob in self.order_blocks:
            age = index - ob["index"]
            if 0 < age < self.ob_max_age:
                size = ob["top"] - ob["bottom"]
                buffer = max(size * 2, 0.05)
                if (ob["bottom"] - buffer) <= price <= (ob["top"] + buffer):
                    return ob["type"]
        return None

    def in_fvg_zone(self, price, index):
        for fvg in self.fvgs:
            age = index - fvg["index"]
            if 0 < age < self.ob_max_age:
                if self.require_unmitigated_fvg and fvg.get("mitigated", False):
                    continue
                size = fvg["top"] - fvg["bottom"]
                buffer = max(size * 2, 0.05)
                if (fvg["bottom"] - buffer) <= price <= (fvg["top"] + buffer):
                    return fvg["type"]
        return None

    def check_signal(self, candles, index):
        """Returns Signal or None."""
        if index < 4:
            return None

        candle = candles[index]

        if not in_session(candle.time_open, self.session):
            self.recent_sweep = None
            return None

        if not in_day_filter(candle.time_open, self.day_filter):
            return None

        bias = self.get_bias(index)
        if bias is None:
            return None

        sweep = self.check_liquidity_sweep(candle, index)
        if sweep:
            self.recent_sweep = sweep
            self.sweep_expiry = index + self.sweep_lookback

        if index > self.sweep_expiry:
            self.recent_sweep = None

        ob_zone = self.in_ob_zone(candle.close, index) if self.use_ob else None
        fvg_zone = self.in_fvg_zone(candle.close, index) if self.use_fvg else None

        if self.require_fvg_ob_confluence:
            if not (ob_zone and fvg_zone):
                ob_zone = None
                fvg_zone = None

        if self.require_bos_confluence:
            if not self._has_recent_bos(index, bias):
                return None

        direction = None

        if bias == "bullish":
            if self.use_liquidity_sweep and self.recent_sweep != "swept_low":
                return None
            if ob_zone == "bullish" or fvg_zone == "bullish":
                direction = "BUY"

        elif bias == "bearish":
            if self.use_liquidity_sweep and self.recent_sweep != "swept_high":
                return None
            if ob_zone == "bearish" or fvg_zone == "bearish":
                direction = "SELL"

        if direction is None:
            return None

        sl = self._find_swing_sl(index, direction, candle)

        return Signal(
            direction=direction,
            stop_loss=sl,
            entry_price=candle.close,
        )