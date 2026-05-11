from datetime import time

# EST sessions (for histdata CSVs)
SESSIONS_EST = {
    "asian": (time(19, 0), time(3, 0)),
    "london": (time(2, 0), time(5, 0)),
    "new_york": (time(7, 0), time(10, 0)),
    "london_close": (time(10, 0), time(12, 0)),
    "london_ny_overlap": (time(8, 0), time(10, 0)),
}

# UTC+2 sessions (for MetaTrader exported CSVs)
SESSIONS_MT5 = {
    "asian": (time(2, 0), time(10, 0)),
    "london": (time(9, 0), time(12, 0)),
    "new_york": (time(14, 0), time(17, 0)),
    "london_close": (time(17, 0), time(19, 0)),
    "london_ny_overlap": (time(15, 0), time(17, 0)),
}

# Active session map (switch based on data source)
_active_sessions = SESSIONS_EST


def get_sessions_for_tz(tz="est"):
    if tz and tz.lower() in ("mt5", "utc+2", "server"):
        return SESSIONS_MT5
    return SESSIONS_EST


def set_timezone(tz="est"):
    global _active_sessions
    _active_sessions = get_sessions_for_tz(tz)


def in_session(candle_time, session_name, sessions_map=None):
    if session_name == "all":
        return True
    active = sessions_map or _active_sessions
    if session_name not in active:
        return True

    t = candle_time.time()
    start, end = active[session_name]
    if start > end:
        return t >= start or t < end
    return start <= t < end


def get_session(candle_time, sessions_map=None):
    active = sessions_map or _active_sessions
    for name in active:
        if in_session(candle_time, name, sessions_map=active):
            return name
    return "off_hours"


def filter_by_session(candles, session_name, sessions_map=None):
    active = sessions_map or _active_sessions
    return [c for c in candles if in_session(c.time_open, session_name, sessions_map=active)]


def in_day_filter(candle_time, allowed_days):
    if not allowed_days:
        return True
    return candle_time.weekday() in allowed_days


def get_asian_range(candles, sessions_map=None):
    active = sessions_map or _active_sessions
    asian = filter_by_session(candles, "asian", sessions_map=active)
    if not asian:
        return None
    return {
        "high": max(c.high for c in asian),
        "low": min(c.low for c in asian),
        "mid": (max(c.high for c in asian) + min(c.low for c in asian)) / 2,
    }
