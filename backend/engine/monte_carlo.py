import random

def _calculate_percentile(data, percentile):
    if not data: return 0.0
    sorted_data = sorted(data)
    index = (len(sorted_data) - 1) * (percentile / 100.0)
    lower = int(index)
    upper = lower + 1
    if upper >= len(sorted_data): return sorted_data[-1]
    return sorted_data[lower] + (index - lower) * (sorted_data[upper] - sorted_data[lower])

def _run_metrics(pnls, starting_balance):
    if not pnls:
        return {"net_pnl": 0.0, "win_rate": 0.0, "profit_factor": 0.0, "max_drawdown_pct": 0.0}

    winners = [p for p in pnls if p > 0]
    losers = [p for p in pnls if p < 0]

    net_pnl = sum(pnls)
    trade_count = len(pnls)
    win_rate = (len(winners) / trade_count) * 100 if trade_count > 0 else 0.0

    gross_profit = sum(winners)
    gross_loss = abs(sum(losers))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    equity = starting_balance
    peak = starting_balance
    max_drawdown_pct = 0.0

    for pnl in pnls:
        equity += pnl
        if equity > peak:
            peak = equity
        drawdown_pct = ((peak - equity) / peak) * 100 if peak > 0 else 0.0
        if drawdown_pct > max_drawdown_pct:
            max_drawdown_pct = drawdown_pct

    return {
        "net_pnl": net_pnl,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "max_drawdown_pct": max_drawdown_pct,
    }

def run_monte_carlo(
        trade_r_multiples,
        runs=1000,
        starting_balance=10000.0,
        risk_per_trade_pct=1.0,
        sampling_method="bootstrap",
        missed_trade_pct=5.0,
        pnl_variation_pct=10.0,
        price_noise_pct=0.0,
        slippage_per_trade=0.0,
        spread_per_trade=0.0,
        per_trade_cost=None,
        ruin_drawdown_pct=20.0,
        seed=None,
):
    if not trade_r_multiples:
        return {"summary": {"runs": 0}, "distribution": [], "sample_runs": []}

    run_count = max(1, int(runs))
    risk_pct = max(0.0, float(risk_per_trade_pct)) / 100.0
    pnl_var = max(0.0, float(pnl_variation_pct)) / 100.0
    price_var = max(0.0, float(price_noise_pct)) / 100.0
    miss_pct = max(0.0, float(missed_trade_pct)) / 100.0
    ruin_threshold = max(0.0, float(ruin_drawdown_pct))
    fixed_cost = float(per_trade_cost) if per_trade_cost is not None else (max(0.0, float(slippage_per_trade)) + max(0.0, float(spread_per_trade)))
    effective_var = max(pnl_var, price_var)

    rng = random.Random(seed)
    run_results = []
    base_trades = list(trade_r_multiples)
    trade_count = len(base_trades)

    for run_idx in range(run_count):
        # 1. Generate the Trade Sequence
        if sampling_method == "bootstrap":
            path = [rng.choice(base_trades) for _ in range(trade_count)]
        elif sampling_method == "shuffle":
            path = base_trades[:]
            rng.shuffle(path)
        else:
            path = base_trades[:]

        adjusted_pnls = []
        equity = float(starting_balance)
        peak = float(starting_balance)
        ruin_hit = False

        # 2. Execute the trades sequentially
        for base_r in path:
            # Execution Risk: Did the broker drop our connection?
            if rng.random() < miss_pct:
                continue

            r_multiple = float(base_r)

            # Add volatility noise to the outcome (Slippage)
            if effective_var > 0:
                r_multiple *= rng.uniform(1 - effective_var, 1 + effective_var)

            # Calculate PnL in dollars based on CURRENT equity (Compounding)
            pnl = (equity * risk_pct * r_multiple) - fixed_cost

            adjusted_pnls.append(pnl)
            equity += pnl

            # 3. Live Drawdown & Ruin Check (Prevents Zombie Trading)
            if equity > peak:
                peak = equity

            current_dd = ((peak - equity) / peak) * 100 if peak > 0 else 0.0

            if current_dd >= ruin_threshold or equity <= 0:
                ruin_hit = True
                break # Account blown or max DD hit. STOP trading.

        # Calculate metrics for the surviving trades
        metrics = _run_metrics(adjusted_pnls, starting_balance)
        metrics["run"] = run_idx + 1
        metrics["ruin"] = ruin_hit
        metrics["trades_taken"] = len(adjusted_pnls)
        run_results.append(metrics)

    # --- Aggregate Statistics ---
    pnls = [r["net_pnl"] for r in run_results]
    dds = [r["max_drawdown_pct"] for r in run_results]

    profitable_runs = sum(1 for p in pnls if p > 0)
    ruin_count = sum(1 for r in run_results if r["ruin"])

    summary = {
        "runs": run_count,
        "avg_pnl": round(sum(pnls) / run_count, 2),
        "worst_case_pnl_5th_pct": round(_calculate_percentile(pnls, 5), 2), # 95% Confidence you make at least this much
        "profitable_run_pct": round((profitable_runs / run_count) * 100, 2),

        "avg_max_drawdown_pct": round(sum(dds) / run_count, 2),
        "worst_case_dd_95th_pct": round(_calculate_percentile(dds, 95), 2), # 95% Confidence your DD won't exceed this
        "worst_max_drawdown_pct": round(max(dds), 2),

        "avg_win_rate": round(sum(r["win_rate"] for r in run_results) / run_count, 2),
        "avg_profit_factor": round(sum(r["profit_factor"] for r in run_results) / run_count, 2),
        "probability_of_ruin": round((ruin_count / run_count) * 100, 2),
    }

    return {
        "summary": summary,
        "distribution": run_results,
        "sample_runs": run_results,
    }