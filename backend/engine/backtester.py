from data.model import Trade
from collections import defaultdict
import math


INTRABAR_POLICIES = ("stop_first", "target_first", "ohlc_path")
DEFAULT_INTRABAR_POLICY = "stop_first"


def _normalize_policy(policy):
    if policy in INTRABAR_POLICIES:
        return policy
    return DEFAULT_INTRABAR_POLICY


def _open_position(signal, candle, equity, risk_reward, risk_pct,
                   slippage=0.0, spread=0.0):
    """Create a position from a signal, respecting limit-order semantics.

    If signal.entry_price is set we treat it as a limit order:
    - BUY  limit: fills only if candle.low  <= entry_price (price dips to the level)
    - SELL limit: fills only if candle.high >= entry_price (price rises to the level)
    A gap through the limit fills at the candle open (better for the trader).
    If the candle never reaches the limit this returns None so the caller can
    keep the signal pending for the next candle.

    Without entry_price (market order) the fill is candle.open as before.

    slippage and spread are applied against the trader (worse fill).
    """
    is_long = signal.direction == "BUY"
    penalty = max(float(slippage or 0.0), 0.0) + max(float(spread or 0.0), 0.0)
    limit = getattr(signal, "entry_price", None)

    if limit is not None and math.isfinite(limit):
        if is_long:
            if candle.low > limit:
                return None  # price never dipped to our buy limit
            raw_entry = min(candle.open, limit)  # gap-down fills at open
        else:
            if candle.high < limit:
                return None  # price never rose to our sell limit
            raw_entry = max(candle.open, limit)  # gap-up fills at open
    else:
        raw_entry = candle.open

    entry = raw_entry + penalty if is_long else raw_entry - penalty
    sl = signal.stop_loss
    sl_distance = abs(entry - sl)
    if (
        sl_distance <= 0
        or not math.isfinite(sl_distance)
        or not math.isfinite(entry)
        or not math.isfinite(sl)
        or risk_pct <= 0
    ):
        return None

    risk_amount = equity * (risk_pct / 100)
    if risk_amount <= 0 or not math.isfinite(risk_amount):
        return None

    lot_size = risk_amount / sl_distance
    if lot_size <= 0 or not math.isfinite(lot_size):
        return None

    return {
        "direction": "long" if is_long else "short",
        "entry_price": entry,
        "enter_time": candle.time_open,
        "stop_loss": sl,
        "take_profit": entry + (sl_distance * risk_reward) if is_long else entry - (sl_distance * risk_reward),
        "risk_distance": sl_distance,
        "lot_size": lot_size,
        "initial_lot_size": lot_size,
        "break_even_armed": False,
        "partial_tp_taken": False,
        "partial_tp_realized_pnl": 0.0,
    }


def _apply_break_even_if_triggered(position, candle, strategy):
    if not position:
        return

    if not getattr(strategy, "use_break_even", False):
        return

    if position.get("break_even_armed"):
        return

    trigger_rr = float(getattr(strategy, "be_trigger_rr", 1.0) or 0.0)
    if trigger_rr <= 0:
        return

    is_long = position["direction"] == "long"
    entry = position["entry_price"]
    risk_distance = max(position.get("risk_distance", 0.0), 0.0)
    if risk_distance <= 0:
        return

    trigger_price = entry + (risk_distance * trigger_rr) if is_long else entry - (risk_distance * trigger_rr)
    reached_trigger = candle.high >= trigger_price if is_long else candle.low <= trigger_price
    if reached_trigger:
        position["stop_loss"] = entry
        position["break_even_armed"] = True


def _apply_partial_tp_if_triggered(position, candle, strategy):
    if not position:
        return

    if not getattr(strategy, "use_partial_tp", False):
        return

    if position.get("partial_tp_taken"):
        return

    trigger_rr = float(getattr(strategy, "partial_tp_rr", 1.0) or 0.0)
    if trigger_rr <= 0:
        return

    partial_pct = float(getattr(strategy, "partial_tp_percent", 0.0) or 0.0)
    if partial_pct <= 0:
        return

    is_long = position["direction"] == "long"
    entry = position["entry_price"]
    risk_distance = max(position.get("risk_distance", 0.0), 0.0)
    if risk_distance <= 0:
        return

    trigger_price = entry + (risk_distance * trigger_rr) if is_long else entry - (risk_distance * trigger_rr)
    reached_trigger = candle.high >= trigger_price if is_long else candle.low <= trigger_price
    if not reached_trigger:
        return

    lot_size = max(position.get("lot_size", 0.0), 0.0)
    if lot_size <= 0:
        return

    partial_pct = min(partial_pct, 100.0)
    partial_lot = lot_size * (partial_pct / 100.0)
    if partial_lot <= 0:
        return

    price_move = (trigger_price - entry) if is_long else (entry - trigger_price)
    partial_pnl = price_move * partial_lot

    position["lot_size"] = max(lot_size - partial_lot, 0.0)
    position["partial_tp_taken"] = True
    position["partial_tp_realized_pnl"] = position.get("partial_tp_realized_pnl", 0.0) + partial_pnl


def _resolve_intrabar_exit(position, candle, intrabar_policy):
    """Return (hit_sl, hit_tp, exit_price) applying the intrabar policy.

    When only one of stop/target is touched this is unambiguous.  When both
    are touched inside a single candle the OHLC does not reveal the order,
    so the configured policy decides which fill wins.
    """
    is_long = position["direction"] == "long"
    sl, tp = position["stop_loss"], position["take_profit"]

    if is_long:
        hit_sl = candle.low <= sl
        hit_tp = candle.high >= tp
    else:
        hit_sl = candle.high >= sl
        hit_tp = candle.low <= tp

    if not hit_sl and not hit_tp:
        return False, False, None

    if hit_sl and hit_tp:
        if intrabar_policy == "target_first":
            return False, True, tp
        if intrabar_policy == "ohlc_path":
            # Deterministic path: open -> high -> low -> close for bull candles,
            # open -> low -> high -> close for bear candles.  Whichever level
            # the walked path touches first wins.
            bull_candle = candle.close >= candle.open
            path = (
                [candle.open, candle.high, candle.low, candle.close]
                if bull_candle
                else [candle.open, candle.low, candle.high, candle.close]
            )
            for a, b in zip(path, path[1:]):
                low_leg = min(a, b)
                high_leg = max(a, b)
                if is_long:
                    stop_touched = low_leg <= sl <= high_leg
                    target_touched = low_leg <= tp <= high_leg
                else:
                    stop_touched = low_leg <= sl <= high_leg
                    target_touched = low_leg <= tp <= high_leg
                if stop_touched and target_touched:
                    return True, False, sl
                if stop_touched:
                    return True, False, sl
                if target_touched:
                    return False, True, tp
            return True, False, sl
        return True, False, sl

    if hit_sl:
        return True, False, sl
    return False, True, tp


def _close_position(position, candle, exit_price, exit_time):
    is_long = position["direction"] == "long"
    price_move = (exit_price - position["entry_price"]) if is_long else (position["entry_price"] - exit_price)
    lot_size = max(position.get("lot_size", 0.0), 0.0)
    partial_pnl = float(position.get("partial_tp_realized_pnl", 0.0) or 0.0)
    pnl = (price_move * lot_size) + partial_pnl
    initial_risk = max(
        position.get("risk_distance", 0.0)
        * position.get("initial_lot_size", position.get("lot_size", 0.0)),
        1e-12,
    )
    r_multiple = pnl / initial_risk
    return Trade(
        enter_time=position["enter_time"],
        enter_price=position["entry_price"],
        direction=position["direction"],
        exit_time=exit_time,
        exit_price=exit_price,
        pnl=pnl,
        r_multiple=r_multiple,
        partial_tp_taken=bool(position.get("partial_tp_taken", False)),
        partial_tp_realized_pnl=partial_pnl,
    )


def run_backtest(candles, strategy, starting_balance, risk_reward=1.0,
                 max_daily_loss=0.0, max_consecutive_losses=0, risk_pct=1.0,
                 intrabar_policy=DEFAULT_INTRABAR_POLICY,
                 slippage=0.0, spread=0.0):
    trades = []
    for event in run_backtest_stream(
        candles, strategy, starting_balance, risk_reward=risk_reward,
        max_daily_loss=max_daily_loss, max_consecutive_losses=max_consecutive_losses,
        risk_pct=risk_pct, intrabar_policy=intrabar_policy,
        slippage=slippage, spread=spread,
    ):
        if event["type"] == "trade":
            trades.append(event["trade"])
    return trades


def run_backtest_stream(candles, strategy, starting_balance, risk_reward=1.0,
                        max_daily_loss=0.0, max_consecutive_losses=0, risk_pct=1.0,
                        intrabar_policy=DEFAULT_INTRABAR_POLICY,
                        slippage=0.0, spread=0.0):
    position = None
    pending_signal = None
    pending_since = 0          # candle index when signal was queued
    # Cancel unfilled limit after this many candles. Pulled from strategy if available,
    # so that strategy.max_retest_candles and backtester expiry stay in sync.
    LIMIT_ORDER_EXPIRY = int(getattr(strategy, "max_retest_candles", 8))
    consecutive_losses = 0
    daily_pnl = defaultdict(float)
    total = len(candles)
    equity = float(starting_balance)
    policy = _normalize_policy(intrabar_policy)

    if hasattr(strategy, "prepare"):
        strategy.prepare(candles)

    yield {"type": "start", "total_candles": total}

    progress_interval = max(1, total // 200)

    for i, candle in enumerate(candles):
        if i % progress_interval == 0:
            yield {"type": "progress", "processed_candles": i, "total_candles": total}

        if position is None and pending_signal is not None:
            position = _open_position(pending_signal, candle, equity, risk_reward, risk_pct,
                                      slippage=slippage, spread=spread)
            if position is not None:
                pending_signal = None  # filled
            elif (i - pending_since) >= LIMIT_ORDER_EXPIRY:
                pending_signal = None  # expired unfilled

        if position:
            _apply_break_even_if_triggered(position, candle, strategy)
            _apply_partial_tp_if_triggered(position, candle, strategy)

            hit_sl, hit_tp, exit_price = _resolve_intrabar_exit(position, candle, policy)

            if hit_sl or hit_tp:
                trade = _close_position(position, candle, exit_price, candle.time_open)
                pnl = trade.pnl
                position = None
                equity += pnl

                if pnl <= 0:
                    consecutive_losses += 1
                else:
                    consecutive_losses = 0

                daily_pnl[candle.time_open.date()] += pnl

                yield {"type": "trade", "trade": trade, "processed_candles": i, "total_candles": total}

        if position is None:
            if equity <= 0:
                continue
            if max_consecutive_losses > 0 and consecutive_losses >= max_consecutive_losses:
                continue
            if max_daily_loss > 0:
                loss_limit = starting_balance * (max_daily_loss / 100)
                if daily_pnl[candle.time_open.date()] <= -loss_limit:
                    continue

            signal = strategy.check_signal(candles, i)

            if signal is not None:
                pending_signal = signal
                pending_since = i

    if position and candles:
        last_candle = candles[-1]
        trade = _close_position(position, last_candle, last_candle.close, last_candle.time_open)
        equity += trade.pnl
        daily_pnl[last_candle.time_open.date()] += trade.pnl
        yield {"type": "trade", "trade": trade, "processed_candles": total, "total_candles": total}

    yield {"type": "done", "total_candles": total}
