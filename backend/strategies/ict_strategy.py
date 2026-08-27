from data.model import Signal
from indicators.liquidity import find_liquidity_levels
from indicators.sessions import in_session, in_day_filter, get_sessions_for_tz
from collections import defaultdict
from datetime import timedelta


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
            timezone="est",
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
        self.sessions_map = get_sessions_for_tz(timezone)

        self.swings = []
        self.structure = []
        self.fvgs = []
        self.order_blocks = []
        self.liquidity_levels = []
        self.asian_ranges = {}

        self.recent_sweep = None
        self.sweep_expiry = 0
        self._candles = ()
        self._processed_index = -1
        self._body_values = []
        self._asian_pending = defaultdict(list)
        self._asian_ranges_finalized = set()

    def prepare(self, candles):
        """Reset causal state for a new run.

        Indicators are deliberately not calculated here.  The backtester calls
        ``check_signal`` in chronological order, and that method publishes only
        events whose confirmation candle has already closed.
        """
        self._candles = tuple(candles)
        self.swings = []
        self.structure = []
        self.fvgs = []
        self.order_blocks = []
        self.liquidity_levels = []
        self.asian_ranges = {}
        self.recent_sweep = None
        self.sweep_expiry = 0
        self._processed_index = -1
        self._body_values = []
        self._asian_pending = defaultdict(list)
        self._asian_ranges_finalized = set()

    def _asian_trading_date(self, candle):
        start, end = self.sessions_map["asian"]
        current = candle.time_open.time()
        if start > end and current >= start:
            return candle.time_open.date() + timedelta(days=1)
        return candle.time_open.date()

    def _finalize_asian_range(self, candle, index):
        if "asian" not in self.sessions_map:
            return

        start, end = self.sessions_map["asian"]
        current = candle.time_open.time()
        trading_date = self._asian_trading_date(candle)

        # A range is usable only after the Asian session has ended.  Overnight
        # sessions end when the clock reaches ``end``; non-overnight sessions
        # use the same rule.
        session_has_ended = current >= end if start < end else end <= current < start
        if not session_has_ended or trading_date in self._asian_ranges_finalized:
            return

        asian = self._asian_pending.get(trading_date, [])
        if not asian:
            return

        high = max(c.high for c in asian)
        low = min(c.low for c in asian)
        self.asian_ranges[trading_date] = {
            "high": high,
            "low": low,
            "mid": (high + low) / 2,
            "available_index": index,
        }
        self._asian_ranges_finalized.add(trading_date)

    def _publish_swing(self, event_index, available_index):
        if event_index < self.lookback or event_index + self.lookback != available_index:
            return

        candles = self._candles
        center = candles[event_index]
        neighbors = candles[event_index - self.lookback:event_index + self.lookback + 1]
        is_high = all(center.high > c.high for offset, c in enumerate(neighbors) if offset != self.lookback)
        is_low = all(center.low < c.low for offset, c in enumerate(neighbors) if offset != self.lookback)

        for swing_type, price, matches in (
            ("high", center.high, is_high),
            ("low", center.low, is_low),
        ):
            if not matches:
                continue
            swing = {
                "index": event_index,
                "event_index": event_index,
                "available_index": available_index,
                "price": price,
                "type": swing_type,
            }
            self.swings.append(swing)
            self._publish_structure(swing)

        self.liquidity_levels = find_liquidity_levels(self.swings)

    def _publish_structure(self, swing):
        prior = [s for s in self.swings if s["type"] == swing["type"] and s is not swing]
        if not prior:
            return

        previous = prior[-1]
        if swing["type"] == "high":
            label = "HH" if swing["price"] > previous["price"] else "LH"
        else:
            label = "HL" if swing["price"] > previous["price"] else "LL"

        structure = {**swing, "label": label}
        self.structure.append(structure)
        self._publish_order_block(structure)

    def _publish_order_block(self, structure):
        if structure["label"] not in ("HH", "LL"):
            return

        idx = structure["event_index"]
        for j in range(idx - 1, max(idx - 20, 0), -1):
            candle = self._candles[j]
            if structure["label"] == "HH" and candle.close < candle.open:
                size = candle.open - candle.close
                if size >= self.min_ob_size:
                    self.order_blocks.append({
                        "index": j,
                        "event_index": j,
                        "available_index": structure["available_index"],
                        "type": "bullish",
                        "top": candle.open,
                        "bottom": candle.close,
                    })
                break
            if structure["label"] == "LL" and candle.close > candle.open:
                size = candle.close - candle.open
                if size >= self.min_ob_size:
                    self.order_blocks.append({
                        "index": j,
                        "event_index": j,
                        "available_index": structure["available_index"],
                        "type": "bearish",
                        "top": candle.close,
                        "bottom": candle.open,
                    })
                break

    def _update_causal_state(self, index):
        if index <= self._processed_index:
            return
        if index >= len(self._candles):
            raise IndexError("candle index is outside the prepared data")

        for current_index in range(self._processed_index + 1, index + 1):
            candle = self._candles[current_index]

            if in_session(candle.time_open, "asian", sessions_map=self.sessions_map):
                self._asian_pending[self._asian_trading_date(candle)].append(candle)
            self._finalize_asian_range(candle, current_index)

            # Existing gaps are updated with the current candle before a new
            # three-candle gap is created.
            for fvg in self.fvgs:
                if fvg["mitigated_at"] is not None:
                    continue
                if fvg["type"] == "bullish" and candle.low <= fvg["bottom"]:
                    fvg["mitigated_at"] = current_index
                elif fvg["type"] == "bearish" and candle.high >= fvg["top"]:
                    fvg["mitigated_at"] = current_index

            if current_index >= 2:
                c1, c2, c3 = self._candles[current_index - 2:current_index + 1]
                impulse_ok = True
                if self.impulse_multiplier > 0 and len(self._body_values) >= 2:
                    prior_bodies = self._body_values[:-1]
                    average = sum(prior_bodies[-20:]) / min(20, len(prior_bodies))
                    impulse_ok = average <= 0 or abs(c2.close - c2.open) >= average * self.impulse_multiplier

                if impulse_ok and c1.high < c3.low and c3.low - c1.high >= self.min_gap_size:
                    self.fvgs.append({
                        "index": current_index - 1,
                        "event_index": current_index - 1,
                        "available_index": current_index,
                        "type": "bullish",
                        "top": c3.low,
                        "bottom": c1.high,
                        "mitigated_at": None,
                    })
                elif impulse_ok and c1.low > c3.high and c1.low - c3.high >= self.min_gap_size:
                    self.fvgs.append({
                        "index": current_index - 1,
                        "event_index": current_index - 1,
                        "available_index": current_index,
                        "type": "bearish",
                        "top": c1.low,
                        "bottom": c3.high,
                        "mitigated_at": None,
                    })

            self._body_values.append(abs(candle.close - candle.open))
            self._publish_swing(current_index - self.lookback, current_index)
            self._processed_index = current_index

    def get_bias(self, index):
        recent = [s for s in self.structure if s.get("available_index", s["index"]) <= index]
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
            if swing.get("available_index", swing["index"]) > index:
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

        # Fallback to a causal ATR calculated from candles through the signal
        # candle.  The old implementation used only this candle's range while
        # calling the parameter an ATR multiplier.
        ranges = []
        for current_index in range(max(0, index - 13), index + 1):
            current = self._candles[current_index]
            previous_close = self._candles[current_index - 1].close if current_index else current.open
            ranges.append(max(
                current.high - current.low,
                abs(current.high - previous_close),
                abs(current.low - previous_close),
            ))
        atr = sum(ranges) / len(ranges) if ranges else candle.high - candle.low
        bracket = atr * self.atr_mult
        if direction == "BUY":
            return candle.close - bracket
        return candle.close + bracket

    def _has_recent_bos(self, index, direction):
        for s in reversed(self.structure):
            if s.get("available_index", s["index"]) > index:
                continue
            if s.get("available_index", s["index"]) < index - 20:
                break
            if direction == "bullish" and s["label"] == "HH":
                return True
            if direction == "bearish" and s["label"] == "LL":
                return True
        return False

    def check_liquidity_sweep(self, candle, index):
        today = candle.time_open.date()
        ar = self.asian_ranges.get(today)

        if ar and ar.get("available_index", index) <= index:
            if candle.high > ar["high"] and candle.close < ar["high"]:
                return "swept_high"
            if candle.low < ar["low"] and candle.close > ar["low"]:
                return "swept_low"

        if self.asian_sweep_only:
            return None

        for level in self.liquidity_levels:
            if not level.get("indexes") or max(level["indexes"]) >= index:
                continue
            if level["type"] == "equal_highs":
                if candle.high > level["price"] and candle.close < level["price"]:
                    return "swept_high"
            elif level["type"] == "equal_lows":
                if candle.low < level["price"] and candle.close > level["price"]:
                    return "swept_low"

        return None

    def in_ob_zone(self, price, index):
        for ob in self.order_blocks:
            if ob.get("available_index", index) > index:
                continue
            age = index - ob["index"]
            if 0 < age < self.ob_max_age:
                size = ob["top"] - ob["bottom"]
                buffer = max(size * self.proximity_pct, 0.0)
                if (ob["bottom"] - buffer) <= price <= (ob["top"] + buffer):
                    return ob["type"]
        return None

    def in_fvg_zone(self, price, index):
        for fvg in self.fvgs:
            if fvg.get("available_index", index) > index:
                continue
            age = index - fvg["index"]
            if 0 < age < self.ob_max_age:
                if self.require_unmitigated_fvg and fvg.get("mitigated_at") is not None:
                    continue
                size = fvg["top"] - fvg["bottom"]
                buffer = max(size * self.proximity_pct, 0.0)
                if (fvg["bottom"] - buffer) <= price <= (fvg["top"] + buffer):
                    return fvg["type"]
        return None

    def check_signal(self, candles, index):
        """Returns Signal or None."""
        if not self._candles or tuple(candles) != self._candles:
            self.prepare(candles)
        self._update_causal_state(index)

        if index < 4:
            return None

        candle = candles[index]

        if not in_session(candle.time_open, self.session, sessions_map=self.sessions_map):
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
