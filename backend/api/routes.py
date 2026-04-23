import os
import sys
import json
import time
import random
from functools import lru_cache
from itertools import islice, product
from typing import Literal, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from indicators.sessions import set_timezone
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from data.loader import load_candles, resample_candles
from engine.backtester import run_backtest, run_backtest_stream
from engine.monte_carlo import run_monte_carlo
from indicators.fvg import find_fvgs
from indicators.liquidity import find_liquidity_levels
from indicators.market_structure import detect_structure, find_swing_points
from indicators.order_blocks import find_order_blocks
from strategies.ict_strategy import ICTStrategy

DEFAULT_DATASET = "data.csv"
DATA_DIR = os.path.join(BACKEND_DIR, "data")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _list_csv_datasets():
    if not os.path.isdir(DATA_DIR):
        return []
    return sorted([name for name in os.listdir(DATA_DIR) if name.endswith(".csv")])


def _resolve_dataset(dataset):
    csvs = _list_csv_datasets()
    if not csvs:
        raise HTTPException(status_code=500, detail="No CSV datasets found in backend/data")

    requested = dataset or DEFAULT_DATASET
    if requested in csvs:
        return requested

    if requested == DEFAULT_DATASET:
        return csvs[0]

    raise HTTPException(status_code=400, detail=f"Dataset '{requested}' not found")


def _parse_day_filter(day_filter):
    """Parse comma separated day ints '0,1,2,3,4' into list. None or empty = all days."""
    if not day_filter:
        return None
    try:
        days = [int(d.strip()) for d in day_filter.split(",") if d.strip()]
        valid = [d for d in days if 0 <= d <= 4]
        return valid if valid else None
    except ValueError:
        return None


def _parse_int_list(value, fallback):
    if not value:
        return fallback
    try:
        parsed = [int(part.strip()) for part in value.split(",") if part.strip()]
    except ValueError:
        return fallback
    return parsed or fallback


def _parse_float_list(value, fallback):
    if not value:
        return fallback
    try:
        parsed = [float(part.strip()) for part in value.split(",") if part.strip()]
    except ValueError:
        return fallback
    return parsed or fallback


def _parse_bool_list(value, fallback):
    if not value:
        return fallback
    parsed = []
    for part in value.split(","):
        token = part.strip().lower()
        if token in {"true", "1", "yes", "y"}:
            parsed.append(True)
        elif token in {"false", "0", "no", "n"}:
            parsed.append(False)
    return parsed or fallback


def _parse_str_list(value, fallback):
    if not value:
        return fallback
    parsed = [part.strip() for part in value.split(",") if part.strip()]
    return parsed or fallback


def _dataset_path(dataset_id):
    return os.path.join(DATA_DIR, dataset_id)


def _dataset_mtime(dataset_id):
    path = _dataset_path(dataset_id)
    try:
        return os.path.getmtime(path)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Dataset '{dataset_id}' not found") from exc


@lru_cache(maxsize=32)
def _load_candles_cached(dataset_id, dataset_mtime):
    candles = load_candles(f"data/{dataset_id}")
    return tuple(candles)


@lru_cache(maxsize=128)
def _resample_candles_cached(dataset_id, timeframe, dataset_mtime):
    candles_1m = _load_candles_cached(dataset_id, dataset_mtime)
    candles = resample_candles(candles_1m, period=timeframe)
    return tuple(candles)


def _get_candles_for_timeframe(dataset_id, timeframe):
    return _resample_candles_cached(dataset_id, int(timeframe), _dataset_mtime(dataset_id))


def _build_strategy(
    session, lookback, ob_age, atr_mult, use_fvg, use_ob,
    proximity_pct, sweep, sweep_lookback,
    min_gap_size, impulse_multiplier, require_unmitigated_fvg,
    require_bos_confluence, min_ob_size, require_fvg_ob_confluence,
    asian_sweep_only, day_filter,
    use_break_even=False, be_trigger_rr=1.0,
    use_partial_tp=False, partial_tp_rr=1.0, partial_tp_percent=50.0,
):
    return ICTStrategy(
        session=session,
        lookback=lookback,
        ob_max_age=ob_age,
        atr_mult=atr_mult,
        use_fvg=use_fvg,
        use_ob=use_ob,
        proximity_pct=proximity_pct,
        use_liquidity_sweep=sweep,
        sweep_lookback=sweep_lookback,
        min_gap_size=min_gap_size,
        impulse_multiplier=impulse_multiplier,
        require_unmitigated_fvg=require_unmitigated_fvg,
        require_bos_confluence=require_bos_confluence,
        min_ob_size=min_ob_size,
        require_fvg_ob_confluence=require_fvg_ob_confluence,
        asian_sweep_only=asian_sweep_only,
        day_filter=_parse_day_filter(day_filter),
        use_break_even=use_break_even,
        be_trigger_rr=be_trigger_rr,
        use_partial_tp=use_partial_tp,
        partial_tp_rr=partial_tp_rr,
        partial_tp_percent=partial_tp_percent,
    )


def _trade_payload(trade):
    return {
        "enter_time": trade.enter_time.isoformat(),
        "exit_time": trade.exit_time.isoformat(),
        "enter_price": trade.enter_price,
        "exit_price": trade.exit_price,
        "direction": trade.direction,
        "pnl": trade.pnl,
        "r_multiple": getattr(trade, "r_multiple", 0.0),
        "partial_tp_taken": getattr(trade, "partial_tp_taken", False),
        "partial_tp_realized_pnl": getattr(trade, "partial_tp_realized_pnl", 0.0),
    }


def _stats_payload(trades, rr):
    total_pnl = sum(t.pnl for t in trades)
    winners = [t for t in trades if t.pnl > 0]
    losers = [t for t in trades if t.pnl <= 0]
    partial_tp_trades = [t for t in trades if getattr(t, "partial_tp_taken", False)]
    partial_tp_realized_total = sum(float(getattr(t, "partial_tp_realized_pnl", 0.0) or 0.0) for t in partial_tp_trades)
    return {
        "total_trades": len(trades),
        "winners": len(winners),
        "losers": len(losers),
        "win_rate": len(winners) / len(trades) * 100 if trades else 0,
        "total_pnl": total_pnl,
        "avg_win": sum(t.pnl for t in winners) / len(winners) if winners else 0,
        "avg_loss": sum(t.pnl for t in losers) / len(losers) if losers else 0,
        "risk_reward": rr,
        "partial_tp_trades": len(partial_tp_trades),
        "partial_tp_rate": (len(partial_tp_trades) / len(trades) * 100) if trades else 0,
        "partial_tp_realized_total": partial_tp_realized_total,
        "partial_tp_realized_avg": (partial_tp_realized_total / len(partial_tp_trades)) if partial_tp_trades else 0,
    }


def _build_monte_carlo_payload(trade_r_multiples, *, runs, starting_balance, risk_per_trade_pct, sampling_method,
                               missed_trade_pct, pnl_variation_pct, price_noise_pct, slippage_per_trade,
                               spread_per_trade, ruin_drawdown_pct, seed=None, base=None):
    monte_carlo = run_monte_carlo(
        trade_r_multiples=trade_r_multiples,
        runs=runs,
        starting_balance=starting_balance,
        risk_per_trade_pct=risk_per_trade_pct,
        sampling_method=sampling_method,
        missed_trade_pct=missed_trade_pct,
        pnl_variation_pct=pnl_variation_pct,
        price_noise_pct=price_noise_pct,
        slippage_per_trade=slippage_per_trade,
        spread_per_trade=spread_per_trade,
        ruin_drawdown_pct=ruin_drawdown_pct,
        seed=seed,
    )

    summary = dict(monte_carlo.get("summary", {}))
    distribution = monte_carlo.get("distribution", [])
    sample_runs = monte_carlo.get("sample_runs", distribution)
    return {
        **monte_carlo,
        "summary": summary,
        "distribution": distribution,
        "sample_runs": sample_runs,
        "base": base or None,
    }


class MonteCarloRequest(BaseModel):
    trade_r_multiples: list[float] = Field(default_factory=list, min_length=1)
    runs: int = Field(default=500, ge=1, le=20000)
    starting_balance: float = Field(default=10000.0, gt=0)
    risk_per_trade_pct: float = Field(default=1.0, ge=0.0, le=100.0)
    sampling_method: Literal["bootstrap", "shuffle"] = "bootstrap"
    missed_trade_pct: float = Field(default=5.0, ge=0.0, le=100.0)
    pnl_variation_pct: float = Field(default=15.0, ge=0.0, le=100.0)
    price_noise_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    slippage_per_trade: float = Field(default=0.0, ge=0.0)
    spread_per_trade: float = Field(default=0.0, ge=0.0)
    ruin_drawdown_pct: float = Field(default=20.0, ge=0.0, le=100.0)
    seed: Optional[int] = None
    base_trade_count: Optional[int] = None
    base_net_pnl: Optional[float] = None
    base_win_rate: Optional[float] = None
    base_profit_factor: Optional[float] = None
    base_max_drawdown_pct: Optional[float] = None


def _build_equity_points(trades, starting_balance=10000.0):
    equity = starting_balance
    points = [starting_balance]
    for trade in sorted(trades, key=lambda t: t.exit_time):
        equity += trade.pnl
        points.append(equity)
    return points


def _risk_metrics(trades, starting_balance=10000.0):
    if not trades:
        return {
            "net_pnl": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "sharpe_ratio": 0.0,
            "sortino_ratio": 0.0,
            "max_drawdown_pct": 0.0,
            "calmar_ratio": 0.0,
            "recovery_ratio": 0.0,
            "trade_count": 0,
            "trade_score": 0.0,
            "pf_x_wr": 0.0,
            "custom_fitness": 0.0,
        }

    pnls = [t.pnl for t in trades]
    winners = [p for p in pnls if p > 0]
    losers = [p for p in pnls if p < 0]

    trade_count = len(trades)
    net_pnl = sum(pnls)
    win_rate = (len(winners) / trade_count) * 100 if trade_count else 0.0

    gross_profit = sum(winners)
    gross_loss = abs(sum(losers))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    mean_pnl = net_pnl / trade_count if trade_count else 0.0
    variance = sum((p - mean_pnl) ** 2 for p in pnls) / trade_count if trade_count else 0.0
    std_dev = variance ** 0.5
    sharpe = (mean_pnl / std_dev) * (trade_count ** 0.5) if std_dev > 0 else 0.0

    downside = [min(0.0, p - mean_pnl) for p in pnls]
    downside_variance = (sum(d * d for d in downside) / trade_count) if trade_count else 0.0
    downside_dev = downside_variance ** 0.5
    sortino = (mean_pnl / downside_dev) * (trade_count ** 0.5) if downside_dev > 0 else 0.0

    equity_points = _build_equity_points(trades, starting_balance=starting_balance)
    peak = equity_points[0]
    max_drawdown_pct = 0.0
    for value in equity_points:
        if value > peak:
            peak = value
        drawdown_pct = ((peak - value) / peak) * 100 if peak > 0 else 0.0
        if drawdown_pct > max_drawdown_pct:
            max_drawdown_pct = drawdown_pct

    calmar = (net_pnl / max_drawdown_pct) if max_drawdown_pct > 0 else 0.0
    recovery = (net_pnl / max_drawdown_pct) if max_drawdown_pct > 0 else 0.0

    if trade_count < 80:
        trade_score = max(0.0, trade_count / 80)
    elif trade_count > 400:
        trade_score = max(0.0, 400 / trade_count)
    else:
        trade_score = 1.0

    pf_x_wr = profit_factor * (win_rate / 100)
    custom_fitness = pf_x_wr * trade_score

    return {
        "net_pnl": round(net_pnl, 6),
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 6),
        "sharpe_ratio": round(sharpe, 6),
        "sortino_ratio": round(sortino, 6),
        "max_drawdown_pct": round(max_drawdown_pct, 6),
        "calmar_ratio": round(calmar, 6),
        "recovery_ratio": round(recovery, 6),
        "trade_count": trade_count,
        "trade_score": round(trade_score, 6),
        "pf_x_wr": round(pf_x_wr, 6),
        "custom_fitness": round(custom_fitness, 6),
    }


def _dominates(a, b):
    maximize_keys = [
        "net_pnl",
        "sharpe_ratio",
        "sortino_ratio",
        "profit_factor",
        "calmar_ratio",
        "recovery_ratio",
        "win_rate",
        "trade_score",
        "pf_x_wr",
        "custom_fitness",
    ]
    no_worse = all(a.get(key, 0) >= b.get(key, 0) for key in maximize_keys) and a.get("max_drawdown_pct", 0) <= b.get("max_drawdown_pct", 0)
    strictly_better = any(a.get(key, 0) > b.get(key, 0) for key in maximize_keys) or a.get("max_drawdown_pct", 0) < b.get("max_drawdown_pct", 0)
    return no_worse and strictly_better


def _pareto_front(items):
    front = []
    for candidate in items:
        dominated = False
        for other in items:
            if other is candidate:
                continue
            if _dominates(other, candidate):
                dominated = True
                break
        if not dominated:
            front.append(candidate)
    return front


class OptimizeRequest(BaseModel):
    timeframe: int = Field(default=5, ge=1)
    rr: float = Field(default=2.5, gt=0)
    rr_values: list[float] = Field(default_factory=lambda: [2.5], min_length=1)
    dataset: str = DEFAULT_DATASET

    min_trades: int = Field(default=5, ge=1)
    max_trades: int = Field(default=1000, ge=1)
    max_combinations: int = Field(default=1000, ge=1, le=50000)
    combo_sampling_mode: Literal["first", "random"] = "random"
    combo_sampling_seed: Optional[int] = None
    top_n: int = Field(default=10, ge=1)

    sessions: list[str] = Field(default_factory=lambda: ["london", "new_york"], min_length=1)
    lookback_values: list[int] = Field(default_factory=lambda: [3, 5, 7, 10], min_length=1)
    ob_age_values: list[int] = Field(default_factory=lambda: [20, 50, 80], min_length=1)
    atr_values: list[float] = Field(default_factory=lambda: [1.0, 1.5, 2.0, 2.5], min_length=1)

    min_ob_size_values: list[float] = Field(default_factory=lambda: [0.00030, 0.00040, 0.00050, 0.00060, 0.00080], min_length=1)
    min_gap_size_values: list[float] = Field(default_factory=lambda: [0.00015, 0.00020, 0.00025, 0.00030, 0.00035], min_length=1)
    impulse_multiplier_values: list[float] = Field(default_factory=lambda: [1.15, 1.25, 1.35, 1.45, 1.60], min_length=1)

    require_unmitigated_fvg_modes: list[bool] = Field(default_factory=lambda: [True, False], min_length=1)
    require_fvg_ob_confluence_modes: list[bool] = Field(default_factory=lambda: [True, False], min_length=1)
    require_bos_confluence_modes: list[bool] = Field(default_factory=lambda: [True, False], min_length=1)
    sweep_modes: list[bool] = Field(default_factory=lambda: [True, False], min_length=1)
    sweep_lb_values: list[int] = Field(default_factory=lambda: [5, 10, 15], min_length=1)
    asian_sweep_only_modes: list[bool] = Field(default_factory=lambda: [True, False], min_length=1)
    use_break_even_modes: list[bool] = Field(default_factory=lambda: [False, True], min_length=1)
    be_trigger_rr_values: list[float] = Field(default_factory=lambda: [1.0, 1.5, 2.0], min_length=1)
    use_partial_tp_modes: list[bool] = Field(default_factory=lambda: [False, True], min_length=1)
    partial_tp_rr_values: list[float] = Field(default_factory=lambda: [1.0, 1.5, 2.0], min_length=1)
    partial_tp_percent_values: list[float] = Field(default_factory=lambda: [50.0], min_length=1)

    rank_objective: Literal[
        "custom_fitness",
        "net_pnl",
        "sharpe_ratio",
        "sortino_ratio",
        "profit_factor",
        "calmar_ratio",
        "recovery_ratio",
        "win_rate",
        "pf_x_wr",
        "trade_score",
        "trade_count",
        "max_drawdown_pct",
    ] = "custom_fitness"


@app.get("/api/datasets")
def get_datasets():
    csvs = _list_csv_datasets()
    default_id = DEFAULT_DATASET if DEFAULT_DATASET in csvs else (csvs[0] if csvs else "")
    datasets = [
        {
            "id": csv,
            "label": csv.replace(".csv", "").replace("_", " ").title(),
            "default": csv == default_id,
        }
        for csv in csvs
    ]
    return {"datasets": datasets}


@app.get("/api/candles")
def get_candles(timeframe: int = 5, dataset: str = DEFAULT_DATASET):
    dataset_id = _resolve_dataset(dataset)
    candles = _get_candles_for_timeframe(dataset_id, timeframe)
    return {
        "candles": [
            {
                "time": c.time_open.isoformat(),
                "open": c.open,
                "high": c.high,
                "low": c.low,
                "close": c.close,
            }
            for c in candles
        ]
    }


@app.get("/api/indicators")
def get_indicators(timeframe: int = 5, dataset: str = DEFAULT_DATASET):
    dataset_id = _resolve_dataset(dataset)
    candles = _get_candles_for_timeframe(dataset_id, timeframe)

    swings = find_swing_points(candles)
    structure = detect_structure(swings)
    levels = find_liquidity_levels(swings)
    fvgs = find_fvgs(candles)
    obs = find_order_blocks(candles, structure)

    candle_times = [c.time_open.isoformat() for c in candles]
    return {
        "candle_times": candle_times,
        "swings": swings,
        "structure": structure,
        "liquidity": levels,
        "fvgs": fvgs,
        "order_blocks": obs,
    }


@app.get("/api/backtest")
def get_backtest(
    timeframe: int = 5,
    rr: float = 2.5,
    lookback: int = 7,
    ob_age: int = 50,
    atr_mult: float = 2.5,
    sweep: bool = True,
    sweep_lookback: int = 5,
    session: str = "london",
    dataset: str = DEFAULT_DATASET,
    use_fvg: bool = True,
    use_ob: bool = True,
    proximity_pct: float = 0.5,
    # FVG Quality
    min_gap_size: float = 0.0,
    impulse_multiplier: float = 0.0,
    require_unmitigated_fvg: bool = True,
    require_bos_confluence: bool = False,
    # Order Block
    min_ob_size: float = 0.0,
    require_fvg_ob_confluence: bool = False,
    # Liquidity
    asian_sweep_only: bool = False,
    # Break-even
    use_break_even: bool = False,
    be_trigger_rr: float = 1.0,
    # Partial TP
    use_partial_tp: bool = False,
    partial_tp_rr: float = 1.0,
    partial_tp_percent: float = 50.0,
    # Time
    day_filter: Optional[str] = None,
    # Risk Management
    max_daily_loss: float = 0.0,
    max_consecutive_losses: int = 0,
):
    dataset_id = _resolve_dataset(dataset)
    if "MT5" in dataset.upper():
        set_timezone("mt5")
    else:
        set_timezone("est")
    candles = _get_candles_for_timeframe(dataset_id, timeframe)

    strategy = _build_strategy(
        session=session, lookback=lookback, ob_age=ob_age, atr_mult=atr_mult,
        use_fvg=use_fvg, use_ob=use_ob, proximity_pct=proximity_pct,
        sweep=sweep, sweep_lookback=sweep_lookback,
        min_gap_size=min_gap_size, impulse_multiplier=impulse_multiplier,
        require_unmitigated_fvg=require_unmitigated_fvg,
        require_bos_confluence=require_bos_confluence,
        min_ob_size=min_ob_size, require_fvg_ob_confluence=require_fvg_ob_confluence,
        asian_sweep_only=asian_sweep_only, day_filter=day_filter,
        use_break_even=use_break_even, be_trigger_rr=be_trigger_rr,
        use_partial_tp=use_partial_tp, partial_tp_rr=partial_tp_rr, partial_tp_percent=partial_tp_percent,
    )
    trades = run_backtest(
        candles, strategy, 10000, risk_reward=rr,
        max_daily_loss=max_daily_loss,
        max_consecutive_losses=max_consecutive_losses,
    )

    return {
        "trades": [_trade_payload(t) for t in trades],
        "candle_times": [c.time_open.isoformat() for c in candles],
        "stats": _stats_payload(trades, rr),
    }


@app.post("/api/backtest/monte-carlo")
def backtest_monte_carlo(req: MonteCarloRequest):
    base = {
        "trade_count": req.base_trade_count if req.base_trade_count is not None else len(req.trade_r_multiples),
        "net_pnl": req.base_net_pnl if req.base_net_pnl is not None else 0.0,
        "win_rate": req.base_win_rate if req.base_win_rate is not None else 0.0,
        "profit_factor": req.base_profit_factor if req.base_profit_factor is not None else 0.0,
        "max_drawdown_pct": req.base_max_drawdown_pct if req.base_max_drawdown_pct is not None else 0.0,
    }

    return _build_monte_carlo_payload(
        req.trade_r_multiples,
        runs=req.runs,
        starting_balance=req.starting_balance,
        risk_per_trade_pct=req.risk_per_trade_pct,
        sampling_method=req.sampling_method,
        missed_trade_pct=req.missed_trade_pct,
        pnl_variation_pct=req.pnl_variation_pct,
        price_noise_pct=req.price_noise_pct,
        slippage_per_trade=req.slippage_per_trade,
        spread_per_trade=req.spread_per_trade,
        ruin_drawdown_pct=req.ruin_drawdown_pct,
        seed=req.seed,
        base=base,
    )


@app.post("/api/optimize")
def get_optimize(req: OptimizeRequest):
    dataset_id = _resolve_dataset(req.dataset)
    candles = _get_candles_for_timeframe(dataset_id, req.timeframe)

    session_list = req.sessions
    lookback_list = req.lookback_values
    ob_age_list = req.ob_age_values
    atr_list = req.atr_values
    rr_list = [float(value) for value in req.rr_values if float(value) > 0]
    if not rr_list:
        rr_list = [req.rr]
    min_ob_size_list = req.min_ob_size_values
    min_gap_size_list = req.min_gap_size_values
    impulse_multiplier_list = req.impulse_multiplier_values
    require_unmitigated_fvg_list = req.require_unmitigated_fvg_modes
    require_fvg_ob_confluence_list = req.require_fvg_ob_confluence_modes
    require_bos_confluence_list = req.require_bos_confluence_modes
    sweep_list = req.sweep_modes
    sweep_lb_list = req.sweep_lb_values
    asian_sweep_only_list = req.asian_sweep_only_modes
    use_break_even_list = req.use_break_even_modes
    be_trigger_rr_list = [float(value) for value in req.be_trigger_rr_values if float(value) > 0]
    if not be_trigger_rr_list:
        be_trigger_rr_list = [1.0]
    use_partial_tp_list = req.use_partial_tp_modes
    partial_tp_rr_list = [float(value) for value in req.partial_tp_rr_values if float(value) > 0]
    if not partial_tp_rr_list:
        partial_tp_rr_list = [1.0]
    partial_tp_percent_list = [float(value) for value in req.partial_tp_percent_values if 0 < float(value) <= 100]
    if not partial_tp_percent_list:
        partial_tp_percent_list = [50.0]

    ranking_key = req.rank_objective

    def _rank_results(items):
        if ranking_key == "max_drawdown_pct":
            return sorted(items, key=lambda x: x.get(ranking_key, 0))
        return sorted(items, key=lambda x: x.get(ranking_key, 0), reverse=True)

    sample_mode = req.combo_sampling_mode
    rng = random.Random(req.combo_sampling_seed) if sample_mode == "random" else None

    combos = []
    base_grid = {
        "session": session_list,
        "rr": rr_list,
        "lookback": lookback_list,
        "ob_age": ob_age_list,
        "atr_mult": atr_list,
        "min_ob_size": min_ob_size_list,
        "min_gap_size": min_gap_size_list,
        "impulse_multiplier": impulse_multiplier_list,
        "require_unmitigated_fvg": require_unmitigated_fvg_list,
        "require_fvg_ob_confluence": require_fvg_ob_confluence_list,
        "require_bos_confluence": require_bos_confluence_list,
        "sweep": sweep_list,
        "asian_sweep_only": asian_sweep_only_list,
        "use_break_even": use_break_even_list,
        "be_trigger_rr": be_trigger_rr_list,
        "use_partial_tp": use_partial_tp_list,
        "partial_tp_rr": partial_tp_rr_list,
        "partial_tp_percent": partial_tp_percent_list,
    }
    base_keys = tuple(base_grid.keys())

    def _candidate_iter():
        for values in product(*(base_grid[key] for key in base_keys)):
            base_params = dict(zip(base_keys, values))
            for sweep_lb in (sweep_lb_list if base_params["sweep"] else [0]):
                yield {
                    **base_params,
                    "sweep_lookback": sweep_lb,
                }

    base_count_without_sweep = 1
    for key in base_keys:
        if key == "sweep":
            continue
        base_count_without_sweep *= len(base_grid[key])

    true_sweep_count = sum(1 for enabled in sweep_list if enabled)
    false_sweep_count = sum(1 for enabled in sweep_list if not enabled)
    sweep_factor = (true_sweep_count * len(sweep_lb_list)) + false_sweep_count
    total_generated_combinations = base_count_without_sweep * sweep_factor

    if sample_mode == "first":
        combos = list(islice(_candidate_iter(), req.max_combinations))
    else:
        for generated_idx, candidate in enumerate(_candidate_iter(), start=1):
            if len(combos) < req.max_combinations:
                if len(combos) < req.max_combinations:
                    combos.append(candidate)
            else:
                replace_index = rng.randint(0, generated_idx - 1)
                if replace_index < req.max_combinations:
                    combos[replace_index] = candidate

    executed_combinations = len(combos)
    capped_by_max_combinations = total_generated_combinations > executed_combinations

    def event_stream():
        started = time.perf_counter()
        results = []

        yield f"data: {json.dumps({'type': 'progress', 'progress': 0, 'processed': 0, 'total_combinations': executed_combinations, 'generated_combinations': total_generated_combinations, 'executed_combinations': executed_combinations, 'max_combinations': req.max_combinations, 'capped_by_max_combinations': capped_by_max_combinations, 'combo_sampling_mode': sample_mode, 'combo_sampling_seed': req.combo_sampling_seed, 'valid_results': 0, 'top_results': []})}\n\n"

        for i, params in enumerate(combos):
            strategy = ICTStrategy(
                session=params["session"],
                lookback=params["lookback"],
                ob_max_age=params["ob_age"],
                atr_mult=params["atr_mult"],
                use_liquidity_sweep=params["sweep"],
                sweep_lookback=params["sweep_lookback"],
                min_gap_size=params["min_gap_size"],
                impulse_multiplier=params["impulse_multiplier"],
                require_unmitigated_fvg=params["require_unmitigated_fvg"],
                require_bos_confluence=params["require_bos_confluence"],
                min_ob_size=params["min_ob_size"],
                require_fvg_ob_confluence=params["require_fvg_ob_confluence"],
                asian_sweep_only=params["asian_sweep_only"],
                use_break_even=params["use_break_even"],
                be_trigger_rr=params["be_trigger_rr"],
                use_partial_tp=params["use_partial_tp"],
                partial_tp_rr=params["partial_tp_rr"],
                partial_tp_percent=params["partial_tp_percent"],
            )
            trades = run_backtest(candles, strategy, 10000, risk_reward=params["rr"])

            if req.min_trades <= len(trades) <= req.max_trades:
                metrics = _risk_metrics(trades, starting_balance=10000.0)
                results.append({
                    "params": params,
                    "risk_reward": params["rr"],
                    "pnl": round(metrics["net_pnl"], 4),
                    "trades": metrics["trade_count"],
                    "win_rate": round(metrics["win_rate"], 2),
                    **metrics,
                })

            if (i + 1) % 4 == 0 or i == len(combos) - 1:
                ranked = _rank_results(results)
                pareto = _pareto_front(results)
                progress = ((i + 1) / max(1, len(combos))) * 100
                payload = {
                    "type": "progress",
                    "progress": progress,
                    "processed": i + 1,
                    "total_combinations": executed_combinations,
                    "generated_combinations": total_generated_combinations,
                    "executed_combinations": executed_combinations,
                    "max_combinations": req.max_combinations,
                    "capped_by_max_combinations": capped_by_max_combinations,
                    "combo_sampling_mode": sample_mode,
                    "combo_sampling_seed": req.combo_sampling_seed,
                    "valid_results": len(ranked),
                    "rank_objective": ranking_key,
                    "top_results": ranked[:max(1, req.top_n)],
                    "pareto_front": sorted(pareto, key=lambda x: x.get("custom_fitness", 0), reverse=True)[:max(1, req.top_n)],
                }
                yield f"data: {json.dumps(payload)}\n\n"

        total_elapsed = time.perf_counter() - started
        ranked = _rank_results(results)
        pareto = _pareto_front(results)
        best = ranked[0] if ranked else None
        safe_elapsed = total_elapsed if total_elapsed > 0 else 0.0001
        payload = {
            "type": "finished",
            "dataset": dataset_id,
            "timeframe": req.timeframe,
            "risk_reward_values": rr_list,
            "min_trades": req.min_trades,
            "max_trades": req.max_trades,
            "rank_objective": ranking_key,
            "all_results": ranked,
            "top_results": ranked[:max(1, req.top_n)],
            "pareto_front": sorted(pareto, key=lambda x: x.get("custom_fitness", 0), reverse=True),
            "best": best,
            "best_result": best,
            "elapsed_seconds": round(total_elapsed, 3),
            "combos_per_second": round(len(combos) / safe_elapsed, 2),
            "total_combinations": executed_combinations,
            "generated_combinations": total_generated_combinations,
            "executed_combinations": executed_combinations,
            "max_combinations": req.max_combinations,
            "capped_by_max_combinations": capped_by_max_combinations,
            "combo_sampling_mode": sample_mode,
            "combo_sampling_seed": req.combo_sampling_seed,
            "valid_results": len(ranked),
        }
        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.get("/api/optimize/monte-carlo")
def get_optimize_monte_carlo(
    timeframe: int = 5,
    rr: float = 2.5,
    dataset: str = DEFAULT_DATASET,
    session: str = "london",
    lookback: int = 7,
    ob_age: int = 50,
    atr_mult: float = 2.5,
    min_ob_size: float = 0.0005,
    min_gap_size: float = 0.00025,
    impulse_multiplier: float = 1.35,
    require_unmitigated_fvg: bool = True,
    require_fvg_ob_confluence: bool = False,
    require_bos_confluence: bool = False,
    sweep: bool = True,
    sweep_lookback: int = 5,
    asian_sweep_only: bool = False,
    use_break_even: bool = False,
    be_trigger_rr: float = 1.0,
    use_partial_tp: bool = False,
    partial_tp_rr: float = 1.0,
    partial_tp_percent: float = 50.0,
    runs: int = Query(default=500, ge=1, le=20000),
    shuffle_trades: bool = True,
    pnl_variation_pct: float = Query(default=15.0, ge=0.0, le=100.0),
    price_noise_pct: float = Query(default=0.0, ge=0.0, le=100.0),
    slippage_per_trade: float = Query(default=0.0, ge=0.0),
    spread_per_trade: float = Query(default=0.0, ge=0.0),
    ruin_drawdown_pct: float = Query(default=20.0, ge=0.0, le=100.0),
):
    dataset_id = _resolve_dataset(dataset)
    candles = _get_candles_for_timeframe(dataset_id, timeframe)

    strategy = _build_strategy(
        session=session,
        lookback=lookback,
        ob_age=ob_age,
        atr_mult=atr_mult,
        use_fvg=True,
        use_ob=True,
        proximity_pct=0.5,
        sweep=sweep,
        sweep_lookback=sweep_lookback,
        min_gap_size=min_gap_size,
        impulse_multiplier=impulse_multiplier,
        require_unmitigated_fvg=require_unmitigated_fvg,
        require_bos_confluence=require_bos_confluence,
        min_ob_size=min_ob_size,
        require_fvg_ob_confluence=require_fvg_ob_confluence,
        asian_sweep_only=asian_sweep_only,
        use_break_even=use_break_even,
        be_trigger_rr=be_trigger_rr,
        use_partial_tp=use_partial_tp,
        partial_tp_rr=partial_tp_rr,
        partial_tp_percent=partial_tp_percent,
        day_filter=None,
    )
    trades = run_backtest(candles, strategy, 10000, risk_reward=rr)
    trade_r_multiples = [getattr(t, "r_multiple", 0.0) for t in trades]

    base_metrics = _risk_metrics(trades, starting_balance=10000.0)
    return {
        "dataset": dataset_id,
        "timeframe": timeframe,
        "risk_reward": rr,
        "best_params": {
            "session": session,
            "lookback": lookback,
            "ob_age": ob_age,
            "atr_mult": atr_mult,
            "min_ob_size": min_ob_size,
            "min_gap_size": min_gap_size,
            "impulse_multiplier": impulse_multiplier,
            "require_unmitigated_fvg": require_unmitigated_fvg,
            "require_fvg_ob_confluence": require_fvg_ob_confluence,
            "require_bos_confluence": require_bos_confluence,
            "sweep": sweep,
            "sweep_lookback": sweep_lookback,
            "asian_sweep_only": asian_sweep_only,
            "use_break_even": use_break_even,
            "be_trigger_rr": be_trigger_rr,
            "use_partial_tp": use_partial_tp,
            "partial_tp_rr": partial_tp_rr,
            "partial_tp_percent": partial_tp_percent,
        },
        "base": {
            "trade_count": len(trades),
            "net_pnl": base_metrics["net_pnl"],
            "win_rate": base_metrics["win_rate"],
            "profit_factor": base_metrics["profit_factor"],
            "max_drawdown_pct": base_metrics["max_drawdown_pct"],
        },
        "config": {
            "runs": runs,
            "risk_per_trade_pct": 1.0,
            "shuffle_trades": shuffle_trades,
            "pnl_variation_pct": pnl_variation_pct,
            "price_noise_pct": price_noise_pct,
            "slippage_per_trade": slippage_per_trade,
            "spread_per_trade": spread_per_trade,
            "ruin_drawdown_pct": ruin_drawdown_pct,
        },
        **_build_monte_carlo_payload(
            trade_r_multiples,
            runs=runs,
            starting_balance=10000.0,
            risk_per_trade_pct=1.0,
            sampling_method="shuffle" if shuffle_trades else "bootstrap",
            missed_trade_pct=0.0,
            pnl_variation_pct=pnl_variation_pct,
            price_noise_pct=price_noise_pct,
            slippage_per_trade=slippage_per_trade,
            spread_per_trade=spread_per_trade,
            ruin_drawdown_pct=ruin_drawdown_pct,
            seed=None,
            base={
                "trade_count": len(trades),
                "net_pnl": base_metrics["net_pnl"],
                "win_rate": base_metrics["win_rate"],
                "profit_factor": base_metrics["profit_factor"],
                "max_drawdown_pct": base_metrics["max_drawdown_pct"],
            },
        ),
    }


@app.get("/api/backtest/stream")
def stream_backtest(
    timeframe: int = 5,
    rr: float = 2.5,
    lookback: int = 7,
    ob_age: int = 50,
    atr_mult: float = 2.5,
    sweep: bool = True,
    sweep_lookback: int = 5,
    session: str = "london",
    dataset: str = DEFAULT_DATASET,
    use_fvg: bool = True,
    use_ob: bool = True,
    proximity_pct: float = 0.5,

    min_gap_size: float = 0.0,
    impulse_multiplier: float = 0.0,
    require_unmitigated_fvg: bool = True,
    require_bos_confluence: bool = False,

    min_ob_size: float = 0.0,
    require_fvg_ob_confluence: bool = False,
    # Liquidity
    asian_sweep_only: bool = False,
    # Break-even
    use_break_even: bool = False,
    be_trigger_rr: float = 1.0,
    # Partial TP
    use_partial_tp: bool = False,
    partial_tp_rr: float = 1.0,
    partial_tp_percent: float = 50.0,
    # Time
    day_filter: Optional[str] = None,
    # Risk Management
    max_daily_loss: float = 0.0,
    max_consecutive_losses: int = 0,
):
    dataset_id = _resolve_dataset(dataset)
    candles = _get_candles_for_timeframe(dataset_id, timeframe)

    strategy = _build_strategy(
        session=session, lookback=lookback, ob_age=ob_age, atr_mult=atr_mult,
        use_fvg=use_fvg, use_ob=use_ob, proximity_pct=proximity_pct,
        sweep=sweep, sweep_lookback=sweep_lookback,
        min_gap_size=min_gap_size, impulse_multiplier=impulse_multiplier,
        require_unmitigated_fvg=require_unmitigated_fvg,
        require_bos_confluence=require_bos_confluence,
        min_ob_size=min_ob_size, require_fvg_ob_confluence=require_fvg_ob_confluence,
        asian_sweep_only=asian_sweep_only, day_filter=day_filter,
        use_break_even=use_break_even, be_trigger_rr=be_trigger_rr,
        use_partial_tp=use_partial_tp, partial_tp_rr=partial_tp_rr, partial_tp_percent=partial_tp_percent,
    )

    def _sse(data):
        return f"data: {json.dumps(data)}\n\n"

    def event_stream():
        started = time.perf_counter()
        streamed_trades = []
        try:
            for event in run_backtest_stream(
                candles, strategy, 10000, risk_reward=rr,
                max_daily_loss=max_daily_loss,
                max_consecutive_losses=max_consecutive_losses,
            ):
                kind = event["type"]
                if kind == "start":
                    yield _sse({"type": "start", "total_candles": event["total_candles"]})
                elif kind == "progress":
                    total = max(1, event["total_candles"])
                    progress_pct = int((event["processed_candles"] / total) * 100)
                    yield _sse({
                        "type": "progress",
                        "processed_candles": event["processed_candles"],
                        "total_candles": event["total_candles"],
                        "progress_pct": progress_pct,
                    })
                elif kind == "trade":
                    trade = event["trade"]
                    streamed_trades.append(trade)
                    yield _sse({
                        "type": "trade",
                        "trade": _trade_payload(trade),
                        "stats": _stats_payload(streamed_trades, rr),
                        "processed_candles": event["processed_candles"],
                        "total_candles": event["total_candles"],
                    })
                elif kind == "done":
                    duration_ms = (time.perf_counter() - started) * 1000
                    yield _sse({
                        "type": "done",
                        "trades": [_trade_payload(t) for t in streamed_trades],
                        "stats": _stats_payload(streamed_trades, rr),
                        "duration_ms": round(duration_ms, 1),
                        "candle_times": [c.time_open.isoformat() for c in candles],
                    })
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
