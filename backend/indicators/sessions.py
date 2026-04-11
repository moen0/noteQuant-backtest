from datetime import time

SESSIONS_EST = {
    "asian": (time(19, 0), time(3, 0)),
    "london": (time(2, 0), time(5, 0)),
    "new_york": (time(7, 0), time(10, 0)),
    "london_close": (time(10, 0), time(12, 0)),
}

def in_session(candle_time, session_name):
    t = candle_time.time()
    start, end = SESSIONS_EST[session_name]
    if start > end:  # crosses midnight
        return t >= start or t < end
    return start <= t < end

def get_session(candle_time):
    for name in SESSIONS_EST:
        if in_session(candle_time, name):
            return name
    return "off_hours"

def filter_by_session(candles, session_name):
    return [c for c in candles if in_session(c.time_open, session_name)]

def get_asian_range(candles):
    asian = filter_by_session(candles, "asian")
    if not asian:
        return None
    return {
        "high": max(c.high for c in asian),
        "low": min(c.low for c in asian),
        "mid": (max(c.high for c in asian) + min(c.low for c in asian)) / 2,
    }