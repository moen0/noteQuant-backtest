from data.model import Trade
from collections import defaultdict
import math


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


def run_backtest(candles, strategy, starting_balance, risk_reward=1.0,
                 max_daily_loss=0.0, max_consecutive_losses=0, risk_pct=1.0):
    trades = []
    position = None
    consecutive_losses = 0
    daily_pnl = defaultdict(float)
    equity = float(starting_balance)
    if hasattr(strategy, "prepare"):
        strategy.prepare(candles)

    for i, candle in enumerate(candles):
        if position:
            _apply_break_even_if_triggered(position, candle, strategy)
            _apply_partial_tp_if_triggered(position, candle, strategy)

            is_long = position["direction"] == "long"
            sl, tp = position["stop_loss"], position["take_profit"]

            hit_sl = candle.low <= sl if is_long else candle.high >= sl
            hit_tp = candle.high >= tp if is_long else candle.low <= tp

            if hit_sl or hit_tp:
                exit_price = sl if hit_sl else tp
                price_move = (exit_price - position["entry_price"]) if is_long else (position["entry_price"] - exit_price)
                lot_size = max(position.get("lot_size", 0.0), 0.0)
                partial_pnl = float(position.get("partial_tp_realized_pnl", 0.0) or 0.0)
                pnl = (price_move * lot_size) + partial_pnl
                risk_distance = max(position.get("risk_distance", 0.0), 1e-12)
                r_multiple = price_move / risk_distance

                trades.append(Trade(
                    enter_time=position["enter_time"],
                    enter_price=position["entry_price"],
                    direction=position["direction"],
                    exit_time=candle.time_open,
                    exit_price=exit_price,
                    pnl=pnl,
                    r_multiple=r_multiple,
                    partial_tp_taken=bool(position.get("partial_tp_taken", False)),
                    partial_tp_realized_pnl=partial_pnl,
                ))
                position = None
                equity += pnl

                if pnl <= 0:
                    consecutive_losses += 1
                else:
                    consecutive_losses = 0

                daily_pnl[candle.time_open.date()] += pnl

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
                is_long = signal.direction == "BUY"
                entry = signal.entry_price
                sl = signal.stop_loss
                sl_distance = abs(entry - sl)
                if (
                    sl_distance <= 0
                    or not math.isfinite(sl_distance)
                    or not math.isfinite(entry)
                    or not math.isfinite(sl)
                    or risk_pct <= 0
                ):
                    continue

                risk_amount = equity * (risk_pct / 100)
                if risk_amount <= 0 or not math.isfinite(risk_amount):
                    continue

                lot_size = risk_amount / sl_distance
                if lot_size <= 0 or not math.isfinite(lot_size):
                    continue

                tp = entry + (sl_distance * risk_reward) if is_long else entry - (sl_distance * risk_reward)

                position = {
                    "direction": "long" if is_long else "short",
                    "entry_price": entry,
                    "enter_time": candle.time_open,
                    "stop_loss": sl,
                    "take_profit": tp,
                    "risk_distance": sl_distance,
                    "lot_size": lot_size,
                    "break_even_armed": False,
                    "partial_tp_taken": False,
                    "partial_tp_realized_pnl": 0.0,
                }

    if position and candles:
        last_candle = candles[-1]
        is_long = position["direction"] == "long"
        exit_price = last_candle.close
        price_move = (exit_price - position["entry_price"]) if is_long else (position["entry_price"] - exit_price)
        lot_size = max(position.get("lot_size", 0.0), 0.0)
        partial_pnl = float(position.get("partial_tp_realized_pnl", 0.0) or 0.0)
        pnl = (price_move * lot_size) + partial_pnl
        risk_distance = max(position.get("risk_distance", 0.0), 1e-12)
        r_multiple = price_move / risk_distance

        trades.append(Trade(
            enter_time=position["enter_time"],
            enter_price=position["entry_price"],
            direction=position["direction"],
            exit_time=last_candle.time_open,
            exit_price=exit_price,
            pnl=pnl,
            r_multiple=r_multiple,
            partial_tp_taken=bool(position.get("partial_tp_taken", False)),
            partial_tp_realized_pnl=partial_pnl,
        ))
        equity += pnl
        daily_pnl[last_candle.time_open.date()] += pnl

    return trades


def run_backtest_stream(candles, strategy, starting_balance, risk_reward=1.0,
                        max_daily_loss=0.0, max_consecutive_losses=0, risk_pct=1.0):
    position = None
    consecutive_losses = 0
    daily_pnl = defaultdict(float)
    total = len(candles)
    equity = float(starting_balance)

    if hasattr(strategy, "prepare"):
        strategy.prepare(candles)

    yield {"type": "start", "total_candles": total}

    progress_interval = max(1, total // 50)

    for i, candle in enumerate(candles):
        if i % progress_interval == 0:
            yield {"type": "progress", "processed_candles": i, "total_candles": total}

        if position:
            _apply_break_even_if_triggered(position, candle, strategy)
            _apply_partial_tp_if_triggered(position, candle, strategy)

            is_long = position["direction"] == "long"
            sl, tp = position["stop_loss"], position["take_profit"]

            hit_sl = candle.low <= sl if is_long else candle.high >= sl
            hit_tp = candle.high >= tp if is_long else candle.low <= tp

            if hit_sl or hit_tp:
                exit_price = sl if hit_sl else tp
                price_move = (exit_price - position["entry_price"]) if is_long else (position["entry_price"] - exit_price)
                lot_size = max(position.get("lot_size", 0.0), 0.0)
                partial_pnl = float(position.get("partial_tp_realized_pnl", 0.0) or 0.0)
                pnl = (price_move * lot_size) + partial_pnl
                risk_distance = max(position.get("risk_distance", 0.0), 1e-12)
                r_multiple = price_move / risk_distance

                trade = Trade(
                    enter_time=position["enter_time"],
                    enter_price=position["entry_price"],
                    direction=position["direction"],
                    exit_time=candle.time_open,
                    exit_price=exit_price,
                    pnl=pnl,
                    r_multiple=r_multiple,
                    partial_tp_taken=bool(position.get("partial_tp_taken", False)),
                    partial_tp_realized_pnl=partial_pnl,
                )
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
                is_long = signal.direction == "BUY"
                entry = signal.entry_price
                sl = signal.stop_loss
                sl_distance = abs(entry - sl)
                if (
                    sl_distance <= 0
                    or not math.isfinite(sl_distance)
                    or not math.isfinite(entry)
                    or not math.isfinite(sl)
                    or risk_pct <= 0
                ):
                    continue

                risk_amount = equity * (risk_pct / 100)
                if risk_amount <= 0 or not math.isfinite(risk_amount):
                    continue

                lot_size = risk_amount / sl_distance
                if lot_size <= 0 or not math.isfinite(lot_size):
                    continue

                tp = entry + (sl_distance * risk_reward) if is_long else entry - (sl_distance * risk_reward)

                position = {
                    "direction": "long" if is_long else "short",
                    "entry_price": entry,
                    "enter_time": candle.time_open,
                    "stop_loss": sl,
                    "take_profit": tp,
                    "risk_distance": sl_distance,
                    "lot_size": lot_size,
                    "break_even_armed": False,
                    "partial_tp_taken": False,
                    "partial_tp_realized_pnl": 0.0,
                }

    if position and candles:
        last_candle = candles[-1]
        is_long = position["direction"] == "long"
        exit_price = last_candle.close
        price_move = (exit_price - position["entry_price"]) if is_long else (position["entry_price"] - exit_price)
        lot_size = max(position.get("lot_size", 0.0), 0.0)
        partial_pnl = float(position.get("partial_tp_realized_pnl", 0.0) or 0.0)
        pnl = (price_move * lot_size) + partial_pnl
        risk_distance = max(position.get("risk_distance", 0.0), 1e-12)
        r_multiple = price_move / risk_distance

        trade = Trade(
            enter_time=position["enter_time"],
            enter_price=position["entry_price"],
            direction=position["direction"],
            exit_time=last_candle.time_open,
            exit_price=exit_price,
            pnl=pnl,
            r_multiple=r_multiple,
            partial_tp_taken=bool(position.get("partial_tp_taken", False)),
            partial_tp_realized_pnl=partial_pnl,
        )
        equity += pnl
        daily_pnl[last_candle.time_open.date()] += pnl
        yield {"type": "trade", "trade": trade, "processed_candles": total, "total_candles": total}

    yield {"type": "done", "total_candles": total}