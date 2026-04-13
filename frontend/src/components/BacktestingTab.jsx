import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';

const CHART_THEME = {
  layout: { background: { color: '#0a0a0a' }, textColor: '#737373', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
  grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
  crosshair: {
    vertLine: { color: 'rgba(250, 250, 250, 0.15)', labelBackgroundColor: '#262626' },
    horzLine: { color: 'rgba(250, 250, 250, 0.15)', labelBackgroundColor: '#262626' },
  },
  rightPriceScale: { borderColor: '#262626', textColor: '#737373' },
  timeScale: { borderColor: '#262626', timeVisible: true, secondsVisible: false },
};

const TIMEFRAMES = [
  { label: '1m', value: 1 },
  { label: '3m', value: 3 },
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1H', value: 60 },
];

const RR_OPTIONS = [1, 1.5, 2, 2.5, 3];
const SESSIONS = ['london', 'new_york', 'asian', 'london_close', 'london_ny_overlap', 'all'];
const DAYS = [
  { label: 'Mon', value: 0 },
  { label: 'Tue', value: 1 },
  { label: 'Wed', value: 2 },
  { label: 'Thu', value: 3 },
  { label: 'Fri', value: 4 },
];
const STARTING_BALANCE = 10000;
const PRESETS_KEY = 'nq_backtest_presets';
const RESULT_HISTORY_KEY = 'nq_backtest_recent_results';

function formatMoney(v) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calculateProfitFactor(trades) {
  const winners = trades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const losers = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
  if (losers <= 0) return winners > 0 ? 999 : 0;
  return Number((winners / losers).toFixed(2));
}

function calculateMaxDrawdown(trades, startingBalance = STARTING_BALANCE) {
  if (!trades.length) return 0;
  let equity = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  trades
      .slice()
      .sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time))
      .forEach((trade) => {
        equity += trade.pnl;
        if (equity > peak) peak = equity;
        const drawdown = ((peak - equity) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      });
  return Number(maxDrawdown.toFixed(2));
}

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
  } catch { return {}; }
}

function savePresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function loadRecentResults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESULT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0,
        5) : [];
  } catch {
    return [];
  }
}

function saveRecentResults(results) {
  localStorage.setItem(RESULT_HISTORY_KEY, JSON.stringify(results.slice(0, 5)));
}

function NumberInput({ label, value, onChange, min, max, step = 1 }) {
  return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">{label}</label>
        <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
        />
      </div>
  );
}

function ToggleInput({ label, value, onChange, color = '#10b981' }) {
  return (
      <button
          className={`flex items-center gap-2 px-3 py-2 text-[12px] font-mono border transition-colors ${
              value ? 'border-[#404040] text-[#fafafa]' : 'border-[#262626] text-[#525252]'
          }`}
          onClick={() => onChange(!value)}
      >
        <span className="w-1.5 h-1.5" style={{ background: value ? color : '#525252' }} />
        {label}
      </button>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
      <div className="mb-4 mt-2">
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-[#525252] font-mono mt-0.5">{subtitle}</p>}
      </div>
  );
}

export function BacktestingTab({ datasets = [], selectedDataset, onDatasetChange, onBacktestComplete }) {
  const chartContainerRef = useRef(null);
  const equityChartRef = useRef(null);
  const chartRef = useRef(null);
  const equityChartObjRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const equitySeriesRef = useRef(null);
  const markersRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const progressResetTimeoutRef = useRef(null);

  const [chartsReady, setChartsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [autoRun, setAutoRun] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcErrorMessage, setMcErrorMessage] = useState('');
  const [mcResult, setMcResult] = useState(null);
  const [mcRuns, setMcRuns] = useState(500);
  const [mcVariationPct, setMcVariationPct] = useState(15);
  const [mcPriceNoisePct, setMcPriceNoisePct] = useState(0);
  const [mcSlippage, setMcSlippage] = useState(0);
  const [mcSpread, setMcSpread] = useState(0);
  const [mcRuinDrawdownPct, setMcRuinDrawdownPct] = useState(20);
  const [mcShuffleTrades, setMcShuffleTrades] = useState(true);

  const [timeframe, setTimeframe] = useState(1);
  const [riskReward, setRiskReward] = useState(2.5);
  const [lookback, setLookback] = useState(7);
  const [atrMult, setAtrMult] = useState(2.5);
  const [session, setSession] = useState('london');

  const [useFvg, setUseFvg] = useState(true);
  const [useOb, setUseOb] = useState(true);
  const [useLiquiditySweep, setUseLiquiditySweep] = useState(true);
  const [obMaxAge, setObMaxAge] = useState(50);
  const [proximityPct, setProximityPct] = useState(0.5);
  const [sweepLookback, setSweepLookback] = useState(5);

  const [minGapSize, setMinGapSize] = useState(0.0);
  const [impulseMultiplier, setImpulseMultiplier] = useState(0.0);
  const [requireUnmitigatedFvg, setRequireUnmitigatedFvg] = useState(true);
  const [requireBosConfluence, setRequireBosConfluence] = useState(false);

  const [minObSize, setMinObSize] = useState(0.0);
  const [requireFvgObConfluence, setRequireFvgObConfluence] = useState(false);

  const [asianSweepOnly, setAsianSweepOnly] = useState(false);
  const [useBreakEven, setUseBreakEven] = useState(false);
  const [beTriggerRr, setBeTriggerRr] = useState(1.0);
  const [usePartialTp, setUsePartialTp] = useState(false);
  const [partialTpRr, setPartialTpRr] = useState(1.0);
  const [partialTpPercent, setPartialTpPercent] = useState(50);

  const [dayFilter, setDayFilter] = useState([0, 1, 2, 3, 4]);

  const [maxDailyLoss, setMaxDailyLoss] = useState(0.0);
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(0);

  // Presets
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [recentResults, setRecentResults] = useState(loadRecentResults);

  const getSettings = () => ({
    timeframe, riskReward, lookback, atrMult, session,
    useFvg, useOb, useLiquiditySweep, obMaxAge, proximityPct, sweepLookback,
    minGapSize, impulseMultiplier, requireUnmitigatedFvg, requireBosConfluence,
    minObSize, requireFvgObConfluence, asianSweepOnly, dayFilter,
    useBreakEven, beTriggerRr,
    usePartialTp, partialTpRr, partialTpPercent,
    maxDailyLoss, maxConsecutiveLosses,
  });

  const applySettings = (s) => {
    if (s.timeframe !== undefined) setTimeframe(s.timeframe);
    if (s.riskReward !== undefined) setRiskReward(s.riskReward);
    if (s.lookback !== undefined) setLookback(s.lookback);
    if (s.atrMult !== undefined) setAtrMult(s.atrMult);
    if (s.session !== undefined) setSession(s.session);
    if (s.useFvg !== undefined) setUseFvg(s.useFvg);
    if (s.useOb !== undefined) setUseOb(s.useOb);
    if (s.useLiquiditySweep !== undefined) setUseLiquiditySweep(s.useLiquiditySweep);
    if (s.obMaxAge !== undefined) setObMaxAge(s.obMaxAge);
    if (s.proximityPct !== undefined) setProximityPct(s.proximityPct);
    if (s.sweepLookback !== undefined) setSweepLookback(s.sweepLookback);
    if (s.minGapSize !== undefined) setMinGapSize(s.minGapSize);
    if (s.impulseMultiplier !== undefined) setImpulseMultiplier(s.impulseMultiplier);
    if (s.requireUnmitigatedFvg !== undefined) setRequireUnmitigatedFvg(s.requireUnmitigatedFvg);
    if (s.requireBosConfluence !== undefined) setRequireBosConfluence(s.requireBosConfluence);
    if (s.minObSize !== undefined) setMinObSize(s.minObSize);
    if (s.requireFvgObConfluence !== undefined) setRequireFvgObConfluence(s.requireFvgObConfluence);
    if (s.asianSweepOnly !== undefined) setAsianSweepOnly(s.asianSweepOnly);
    if (s.useBreakEven !== undefined) setUseBreakEven(s.useBreakEven);
    if (s.beTriggerRr !== undefined) setBeTriggerRr(s.beTriggerRr);
    if (s.usePartialTp !== undefined) setUsePartialTp(s.usePartialTp);
    if (s.partialTpRr !== undefined) setPartialTpRr(s.partialTpRr);
    if (s.partialTpPercent !== undefined) setPartialTpPercent(s.partialTpPercent);
    if (s.dayFilter !== undefined) setDayFilter(s.dayFilter);
    if (s.maxDailyLoss !== undefined) setMaxDailyLoss(s.maxDailyLoss);
    if (s.maxConsecutiveLosses !== undefined) setMaxConsecutiveLosses(s.maxConsecutiveLosses);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const updated = { ...presets, [name]: getSettings() };
    setPresets(updated);
    savePresets(updated);
    setPresetName('');
  };

  const handleLoadPreset = (name) => {
    const preset = presets[name];
    if (preset) applySettings(preset);
    setShowPresets(false);
  };

  const handleDeletePreset = (name) => {
    const updated = { ...presets };
    delete updated[name];
    setPresets(updated);
    savePresets(updated);
  };

  const toggleDay = (day) => {
    setDayFilter((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length ? next : prev;
      }
      return [...prev, day].sort();
    });
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 420,
      ...CHART_THEME,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    if (equityChartRef.current) {
      const eqChart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 160,
        ...CHART_THEME,
        layout: { ...CHART_THEME.layout, fontSize: 10 },
      });
      equityChartObjRef.current = eqChart;
      equitySeriesRef.current = eqChart.addSeries(LineSeries, {
        color: '#10b981',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
    }

    setChartsReady(true);

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      if (equityChartRef.current && equityChartObjRef.current) equityChartObjRef.current.applyOptions({ width: equityChartRef.current.clientWidth });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      equityChartObjRef.current?.remove();
    };
  }, []);

  const runBacktest = useCallback(async () => {
    if (!chartsReady) return;

    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (progressResetTimeoutRef.current) clearTimeout(progressResetTimeoutRef.current);
    setProgressPct(8);
    progressIntervalRef.current = setInterval(() => {
      setProgressPct((prev) => (prev < 92 ? prev + 3 : prev));
    }, 140);

    setLoading(true);

    try {
      const params = new URLSearchParams({
        timeframe: timeframe.toString(),
        rr: riskReward.toString(),
        lookback: lookback.toString(),
        atr_mult: atrMult.toString(),
        session,
        sweep: useLiquiditySweep.toString(),
        sweep_lookback: sweepLookback.toString(),
        ob_age: obMaxAge.toString(),
        dataset: selectedDataset,
        use_fvg: useFvg.toString(),
        use_ob: useOb.toString(),
        proximity_pct: proximityPct.toString(),
        min_gap_size: minGapSize.toString(),
        impulse_multiplier: impulseMultiplier.toString(),
        require_unmitigated_fvg: requireUnmitigatedFvg.toString(),
        require_bos_confluence: requireBosConfluence.toString(),
        min_ob_size: minObSize.toString(),
        require_fvg_ob_confluence: requireFvgObConfluence.toString(),
        asian_sweep_only: asianSweepOnly.toString(),
        use_break_even: useBreakEven.toString(),
        be_trigger_rr: beTriggerRr.toString(),
        use_partial_tp: usePartialTp.toString(),
        partial_tp_rr: partialTpRr.toString(),
        partial_tp_percent: partialTpPercent.toString(),
        day_filter: dayFilter.join(','),
        max_daily_loss: maxDailyLoss.toString(),
        max_consecutive_losses: maxConsecutiveLosses.toString(),
      });

      const [candleRes, backtestRes] = await Promise.all([
        fetch(`http://localhost:8000/api/candles?timeframe=${timeframe}&dataset=${encodeURIComponent(selectedDataset)}`),
        fetch(`http://localhost:8000/api/backtest?${params}`),
      ]);

      const candleData = await candleRes.json();
      const backtestData = await backtestRes.json();

      const candles = candleData.candles.map((c) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candleSeriesRef.current?.setData(candles);

      const markers = [];
      if (backtestData.trades) {
        backtestData.trades.forEach((trade) => {
          const isWin = trade.pnl > 0;
          markers.push({
            time: Math.floor(new Date(trade.enter_time).getTime() / 1000),
            position: trade.direction === 'long' ? 'belowBar' : 'aboveBar',
            color: isWin ? '#10b981' : '#ef4444',
            shape: trade.direction === 'long' ? 'arrowUp' : 'arrowDown',
            text: trade.direction === 'long' ? 'BUY' : 'SELL',
          });
          markers.push({
            time: Math.floor(new Date(trade.exit_time).getTime() / 1000),
            position: 'inBar',
            color: isWin ? '#10b981' : '#ef4444',
            shape: 'circle',
            text: isWin ? `+${trade.pnl.toFixed(2)}` : trade.pnl.toFixed(2),
          });
        });
      }

      markers.sort((a, b) => a.time - b.time);
      markersRef.current?.setMarkers([]);
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      chartRef.current?.timeScale().fitContent();

      if (backtestData.trades?.length) {
        let equity = STARTING_BALANCE;
        const sortedTrades = backtestData.trades.slice().sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
        const eqData = sortedTrades.map((t) => {
          equity += t.pnl;
          return {
            time: Math.floor(new Date(t.exit_time).getTime() / 1000),
            value: Number(equity.toFixed(2)),
          };
        });
        equitySeriesRef.current?.setData(eqData);
        equityChartObjRef.current?.timeScale().fitContent();
      } else {
        equitySeriesRef.current?.setData([]);
      }

      setResults(backtestData);
      onBacktestComplete?.(backtestData);

      if (backtestData?.stats) {
        const snapshot = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          runAt: new Date().toISOString(),
          dataset: selectedDataset,
          timeframe,
          riskReward,
          totalPnl: Number(backtestData.stats.total_pnl ?? 0),
          winRate: Number(backtestData.stats.win_rate ?? 0),
          totalTrades: Number(backtestData.stats.total_trades ?? 0),
        };
        setRecentResults((prev) => {
          const next = [snapshot, ...prev].slice(0, 5);
          saveRecentResults(next);
          return next;
        });
      }
    } catch (err) {
      console.error('Backtest failed:', err);
    } finally {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setProgressPct(100);
      setLoading(false);
      progressResetTimeoutRef.current = setTimeout(() => {
        setProgressPct(0);
      }, 500);
    }
  }, [
    chartsReady, timeframe, riskReward, lookback, atrMult, session,
    useFvg, useOb, useLiquiditySweep, sweepLookback, obMaxAge,
    selectedDataset, proximityPct, minGapSize, impulseMultiplier,
    requireUnmitigatedFvg, requireBosConfluence, minObSize,
    requireFvgObConfluence, asianSweepOnly, dayFilter,
    useBreakEven, beTriggerRr,
    usePartialTp, partialTpRr, partialTpPercent,
    maxDailyLoss, maxConsecutiveLosses, onBacktestComplete,
  ]);

  const runMonteCarlo = useCallback(async () => {
    if (!results?.trades?.length) {
      setMcErrorMessage('Run a backtest first so Monte Carlo has trades to simulate.');
      return;
    }

    const trades = results.trades;
    const totalTradesLocal = trades.length;
    const totalPnlLocal = trades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0);
    const winRateLocal = totalTradesLocal ? (trades.filter((trade) => trade.pnl > 0).length / totalTradesLocal) * 100 : 0;

    setMcLoading(true);
    setMcErrorMessage('');
    setMcResult(null);

    try {
      const response = await fetch('http://localhost:8000/api/backtest/monte-carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_r_multiples: results.trades.map((trade) => Number(trade.r_multiple ?? 0)),
          runs: mcRuns,
          starting_balance: STARTING_BALANCE,
          risk_per_trade_pct: 1,
          sampling_method: mcShuffleTrades ? 'shuffle' : 'bootstrap',
          missed_trade_pct: 0,
          pnl_variation_pct: mcVariationPct,
          price_noise_pct: mcPriceNoisePct,
          slippage_per_trade: mcSlippage,
          spread_per_trade: mcSpread,
          ruin_drawdown_pct: mcRuinDrawdownPct,
          base_trade_count: totalTradesLocal,
          base_net_pnl: totalPnlLocal,
          base_win_rate: winRateLocal,
          base_profit_factor: calculateProfitFactor(results.trades),
          base_max_drawdown_pct: calculateMaxDrawdown(results.trades, STARTING_BALANCE),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail ?? 'Monte Carlo run failed');
      }

      setMcResult(data);
    } catch (err) {
      setMcErrorMessage(err instanceof Error ? err.message : 'Monte Carlo run failed');
    } finally {
      setMcLoading(false);
    }
  }, [
    results,
    mcRuns,
    mcVariationPct,
    mcPriceNoisePct,
    mcSlippage,
    mcSpread,
    mcRuinDrawdownPct,
    mcShuffleTrades,
  ]);

  useEffect(() => {
    if (chartsReady && autoRun) runBacktest();
  }, [runBacktest, chartsReady, autoRun]);

  useEffect(() => {
    let f2 = 0;
    const f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        if (chartRef.current && chartContainerRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
          chartRef.current.timeScale().fitContent();
        }
        if (equityChartObjRef.current && equityChartRef.current) {
          equityChartObjRef.current.applyOptions({ width: equityChartRef.current.clientWidth });
          equityChartObjRef.current.timeScale().fitContent();
        }
      });
    });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); };
  }, []);

  useEffect(() => () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (progressResetTimeoutRef.current) clearTimeout(progressResetTimeoutRef.current);
  }, []);

  const stats = results?.stats;
  const totalTrades = stats?.total_trades ?? 0;
  const winRate = stats?.win_rate ?? 0;
  const totalPnl = stats?.total_pnl ?? 0;
  const partialTpTrades = stats?.partial_tp_trades ?? 0;
  const partialTpRate = stats?.partial_tp_rate ?? 0;
  const partialTpRealized = stats?.partial_tp_realized_total ?? 0;
  const presetNames = Object.keys(presets);
  const mcRunsData = mcResult?.sample_runs ?? mcResult?.distribution ?? [];

  const itemVariants = {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
      <div className="space-y-6">
        <motion.div variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
          {/* Header row */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight mb-1">Backtesting Engine</h2>
              <p className="text-[13px] text-[#525252] font-mono">Adjust parameters and run strategy</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <ToggleInput label="Auto Run" value={autoRun} onChange={setAutoRun} color="#fafafa" />
              {loading && <div className="w-2 h-2 bg-[#10b981] animate-pulse" />}
              <button
                  onClick={() => setShowPresets((p) => !p)}
                  className="px-4 py-2 text-[13px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors"
              >
                Presets
              </button>
              <button
                  onClick={runBacktest}
                  disabled={loading}
                  className="px-5 py-2 text-[13px] font-semibold font-mono bg-[#fafafa] text-black hover:bg-[#e5e5e5] transition-colors disabled:opacity-40"
              >
                {loading ? 'Running...' : 'Run Backtest'}
              </button>
              <button
                  onClick={runMonteCarlo}
                  disabled={loading || mcLoading || !results?.trades?.length}
                  className="px-5 py-2 text-[13px] font-semibold font-mono border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors disabled:opacity-40"
              >
                {mcLoading ? 'Running MC...' : 'Monte Carlo'}
              </button>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#737373] mb-1">
              <span>{loading ? 'Running backtest...' : 'Backtest progress'}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2 border border-[#1f1f1f] bg-black/50 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${loading ? 'bg-[#10b981]' : 'bg-[#404040]'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Presets panel */}
          {showPresets && (
              <div className="mb-6 p-5 border border-[#262626] bg-black">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[14px] font-semibold tracking-tight">Presets</h3>
                  <button
                      onClick={() => setShowPresets(false)}
                      className="text-[#525252] hover:text-[#fafafa] text-[18px] leading-none transition-colors"
                  >
                    x
                  </button>
                </div>

                {/* Save */}
                <div className="flex gap-2 mb-4">
                  <input
                      type="text"
                      placeholder="Preset name..."
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                      className="flex-1 border border-[#262626] bg-[#0a0a0a] text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
                  />
                  <button
                      onClick={handleSavePreset}
                      disabled={!presetName.trim()}
                      className="px-4 py-2 text-[13px] font-mono bg-[#fafafa] text-black hover:bg-[#e5e5e5] transition-colors disabled:opacity-30"
                  >
                    Save Current
                  </button>
                </div>

                {/* List */}
                {presetNames.length === 0 ? (
                    <p className="text-[13px] text-[#525252] font-mono">No saved presets yet.</p>
                ) : (
                    <div className="space-y-2">
                      {presetNames.map((name) => (
                          <div key={name} className="flex items-center justify-between p-3 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
                            <span className="text-[13px] font-mono text-[#fafafa]">{name}</span>
                            <div className="flex gap-2">
                              <button
                                  onClick={() => handleLoadPreset(name)}
                                  className="px-3 py-1 text-[12px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors"
                              >
                                Load
                              </button>
                              <button
                                  onClick={() => handleDeletePreset(name)}
                                  className="px-3 py-1 text-[12px] font-mono border border-[#262626] text-[#ef4444] hover:border-[#ef4444] transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                      ))}
                    </div>
                )}
              </div>
          )}

          {/* Core Strategy */}
          <SectionHeader title="Core Strategy" />
          <div className="flex flex-wrap gap-6 items-end mb-6">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Timeframe</span>
              <div className="flex border border-[#262626]">
                {TIMEFRAMES.map((tf) => (
                    <button key={tf.value} className={`px-3 py-1.5 text-[12px] font-mono transition-colors ${timeframe === tf.value ? 'bg-[#fafafa] text-black' : 'text-[#737373] hover:text-[#fafafa]'}`} onClick={() => setTimeframe(tf.value)}>{tf.label}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Risk : Reward</span>
              <div className="flex border border-[#262626]">
                {RR_OPTIONS.map((rr) => (
                    <button key={rr} className={`px-3 py-1.5 text-[12px] font-mono transition-colors ${riskReward === rr ? 'bg-[#fafafa] text-black' : 'text-[#737373] hover:text-[#fafafa]'}`} onClick={() => setRiskReward(rr)}>1:{rr}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Session</span>
              <div className="flex flex-wrap border border-[#262626]">
                {SESSIONS.map((s) => (
                    <button key={s} className={`px-3 py-1.5 text-[12px] font-mono transition-colors capitalize ${session === s ? 'bg-[#fafafa] text-black' : 'text-[#737373] hover:text-[#fafafa]'}`} onClick={() => setSession(s)}>{s.replace(/_/g, ' ')}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Dataset</span>
              <select className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors" value={selectedDataset} onChange={(e) => onDatasetChange(e.target.value)}>
                {datasets.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <NumberInput label="Lookback" value={lookback} onChange={setLookback} min={1} max={50} />
            <NumberInput label="ATR Multiplier" value={atrMult} onChange={setAtrMult} min={0.1} max={10} step={0.1} />
            <NumberInput label="OB Max Age" value={obMaxAge} onChange={setObMaxAge} min={1} max={200} />
            <NumberInput label="Proximity %" value={proximityPct} onChange={setProximityPct} min={0.01} max={5} step={0.01} />
            <NumberInput label="Sweep Lookback" value={sweepLookback} onChange={setSweepLookback} min={1} max={50} />
          </div>

          <div className="border-t border-[#1a1a1a] my-6" />
          <SectionHeader title="FVG Settings" subtitle="Fair Value Gap quality filters" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <NumberInput label="Min Gap Size" value={minGapSize} onChange={setMinGapSize} min={0} max={0.01} step={0.0001} />
            <NumberInput label="Impulse Multiplier" value={impulseMultiplier} onChange={setImpulseMultiplier} min={0} max={5} step={0.1} />
          </div>
          <div className="flex flex-wrap gap-3 mb-6">
            <ToggleInput label="Fair Value Gaps" value={useFvg} onChange={setUseFvg} />
            <ToggleInput label="Require Unmitigated" value={requireUnmitigatedFvg} onChange={setRequireUnmitigatedFvg} />
            <ToggleInput label="Require BOS Confluence" value={requireBosConfluence} onChange={setRequireBosConfluence} />
          </div>

          <div className="border-t border-[#1a1a1a] my-6" />
          <SectionHeader title="Order Block Settings" subtitle="Order block quality filters" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <NumberInput label="Min OB Size" value={minObSize} onChange={setMinObSize} min={0} max={0.01} step={0.0001} />
          </div>
          <div className="flex flex-wrap gap-3 mb-6">
            <ToggleInput label="Order Blocks" value={useOb} onChange={setUseOb} />
            <ToggleInput label="Require FVG + OB Confluence" value={requireFvgObConfluence} onChange={setRequireFvgObConfluence} />
          </div>

          <div className="border-t border-[#1a1a1a] my-6" />
          <SectionHeader title="Liquidity Settings" subtitle="Sweep and liquidity filters" />
          <div className="flex flex-wrap gap-3 mb-6">
            <ToggleInput label="Liquidity Sweep" value={useLiquiditySweep} onChange={setUseLiquiditySweep} />
            <ToggleInput label="Asian Range Sweep Only" value={asianSweepOnly} onChange={setAsianSweepOnly} />
          </div>

          <div className="border-t border-[#1a1a1a] my-6" />
          <SectionHeader title="Day Filter" subtitle="Select which days to trade" />
          <div className="flex gap-2 mb-6">
            {DAYS.map((d) => (
                <button key={d.value} className={`px-4 py-2 text-[12px] font-mono border transition-colors ${dayFilter.includes(d.value) ? 'bg-[#fafafa] text-black border-[#fafafa]' : 'border-[#262626] text-[#525252] hover:text-[#fafafa]'}`} onClick={() => toggleDay(d.value)}>{d.label}</button>
            ))}
          </div>

          <div className="border-t border-[#1a1a1a] my-6" />
          <SectionHeader title="Risk Management" subtitle="Daily loss limits and streak protection" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <NumberInput label="Max Daily Loss %" value={maxDailyLoss} onChange={setMaxDailyLoss} min={0} max={10} step={0.5} />
            <NumberInput label="Max Consecutive Losses" value={maxConsecutiveLosses} onChange={setMaxConsecutiveLosses} min={0} max={20} step={1} />
            <NumberInput label="BE Trigger (RR)" value={beTriggerRr} onChange={setBeTriggerRr} min={0.1} max={10} step={0.1} />
            <NumberInput label="Partial TP RR" value={partialTpRr} onChange={setPartialTpRr} min={0.1} max={10} step={0.1} />
            <NumberInput label="Partial TP %" value={partialTpPercent} onChange={setPartialTpPercent} min={1} max={100} step={1} />
          </div>
          <div className="flex flex-wrap gap-3 mt-4">
            <ToggleInput label="Use Break-Even" value={useBreakEven} onChange={setUseBreakEven} />
            <ToggleInput label="Use Partial TP" value={usePartialTp} onChange={setUsePartialTp} />
          </div>
        </motion.div>

        {/* Chart */}
        <motion.div variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
          <div className="mb-4">
            <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-1">Backtest Chart</p>
            <h2 className="text-[20px] font-semibold tracking-tight">Trade entries and exits</h2>
          </div>
          <div ref={chartContainerRef} className="h-[420px] border border-[#1a1a1a] overflow-hidden" />
        </motion.div>

        {/* Equity */}
        <motion.div variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
          <div className="mb-4">
            <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-1">Equity Curve</p>
            <h2 className="text-[20px] font-semibold tracking-tight">Balance progression</h2>
          </div>
          <div ref={equityChartRef} className="h-[160px] border border-[#1a1a1a] overflow-hidden" />
        </motion.div>

        {/* Results */}
        {stats && (
            <motion.div variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
              <div className="mb-6">
                <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-1">Results</p>
                <h2 className="text-[20px] font-semibold tracking-tight">Backtest Summary</h2>
                <p className="text-[12px] text-[#737373] font-mono mt-2">CSV: {selectedDataset}</p>
              </div>

              <div className="mb-6 border border-[#1a1a1a] bg-black/30 p-4">
                <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-3">Last 5 Runs</p>
                {recentResults.length === 0 ? (
                  <p className="text-[12px] text-[#737373] font-mono">No previous runs saved yet.</p>
                ) : (
                  <div className="space-y-2">
                    {recentResults.map((run) => (
                      <div key={run.id} className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[12px] font-mono border border-[#1a1a1a] bg-black/40 px-3 py-2">
                        <span className="text-[#a3a3a3]">{new Date(run.runAt).toLocaleString()}</span>
                        <span className="text-[#fafafa]">{run.dataset}</span>
                        <span className="text-[#a3a3a3]">{run.timeframe}m</span>
                        <span className={run.totalPnl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}>${formatMoney(run.totalPnl)}</span>
                        <span className="text-[#60a5fa]">{run.winRate.toFixed(1)}%</span>
                        <span className="text-[#fafafa]">{run.totalTrades} trades</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[#1a1a1a] my-6" />
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-1">Monte Carlo</p>
                    <h3 className="text-[16px] font-semibold tracking-tight">Stress test the current trade set</h3>
                  </div>
                  <button
                      onClick={runMonteCarlo}
                      disabled={mcLoading || !results?.trades?.length}
                      className="px-4 py-2 text-[13px] font-semibold font-mono bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-colors disabled:opacity-40"
                  >
                    {mcLoading ? 'Running Monte Carlo...' : 'Run Monte Carlo'}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <NumberInput label="Runs" value={mcRuns} onChange={setMcRuns} min={1} step={1} />
                  <NumberInput label="PnL Var %" value={mcVariationPct} onChange={setMcVariationPct} min={0} step={1} />
                  <NumberInput label="Price Noise %" value={mcPriceNoisePct} onChange={setMcPriceNoisePct} min={0} step={1} />
                  <NumberInput label="Slippage" value={mcSlippage} onChange={setMcSlippage} min={0} step={0.01} />
                  <NumberInput label="Spread" value={mcSpread} onChange={setMcSpread} min={0} step={0.01} />
                  <NumberInput label="Ruin DD %" value={mcRuinDrawdownPct} onChange={setMcRuinDrawdownPct} min={0} step={1} />
                </div>

                <label className="inline-flex items-center gap-2 text-[12px] font-mono text-[#a3a3a3]">
                  <input
                      type="checkbox"
                      checked={mcShuffleTrades}
                      onChange={(e) => setMcShuffleTrades(e.target.checked)}
                      className="h-4 w-4"
                  />
                  Shuffle trade order each simulation run
                </label>

                {mcErrorMessage && (
                    <div className="border border-[#7f1d1d] bg-[#1b0a0a] text-[#fca5a5] px-4 py-3 text-[12px] font-mono">
                      {mcErrorMessage}
                    </div>
                )}

                {mcResult && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg PnL</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_pnl ?? 0).toFixed(2)}</p></div>
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Profitable %</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.profitable_run_pct ?? 0).toFixed(2)}%</p></div>
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Worst DD %</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.worst_max_drawdown_pct ?? 0).toFixed(2)}%</p></div>
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg WR</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_win_rate ?? 0).toFixed(2)}%</p></div>
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg PF</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_profit_factor ?? 0).toFixed(2)}</p></div>
                        <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Ruin %</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.probability_of_ruin ?? 0).toFixed(2)}%</p></div>
                      </div>

                      <div className="border border-[#1a1a1a] bg-black/40 overflow-auto">
                        <div className="grid grid-cols-[60px_100px_120px_100px_100px_80px] gap-3 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#737373] border-b border-[#1a1a1a]">
                          <span>Run</span>
                          <span>Net PnL</span>
                          <span>Max DD %</span>
                          <span>Win Rate</span>
                          <span>PF</span>
                          <span>Ruin</span>
                        </div>
                        {mcRunsData.map((run) => (
                            <div key={run.run} className="grid grid-cols-[60px_100px_120px_100px_100px_80px] gap-3 px-4 py-2 text-[12px] font-mono border-b border-[#111111]">
                              <span>{run.run}</span>
                              <span className={run.net_pnl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}>{Number(run.net_pnl).toFixed(2)}</span>
                              <span>{Number(run.max_drawdown_pct).toFixed(2)}</span>
                              <span>{Number(run.win_rate).toFixed(2)}%</span>
                              <span>{Number(run.profit_factor).toFixed(2)}</span>
                              <span className={run.ruin ? 'text-[#ef4444]' : 'text-[#737373]'}>{run.ruin ? 'Yes' : 'No'}</span>
                            </div>
                        ))}
                      </div>
                    </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-10 gap-4">
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Net P/L</p>
                  <p className={`text-[24px] font-semibold ${totalPnl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>${formatMoney(totalPnl)}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Win Rate</p>
                  <p className={`text-[24px] font-semibold ${winRate > 50 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>{winRate.toFixed(1)}%</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Total Trades</p>
                  <p className="text-[24px] font-semibold text-[#fafafa]">{totalTrades}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Winners</p>
                  <p className="text-[24px] font-semibold text-[#10b981]">{stats.winners}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Losers</p>
                  <p className="text-[24px] font-semibold text-[#ef4444]">{stats.losers}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Avg Win</p>
                  <p className="text-[24px] font-semibold text-[#10b981]">${formatMoney(stats.avg_win)}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Avg Loss</p>
                  <p className="text-[24px] font-semibold text-[#ef4444]">${formatMoney(Math.abs(stats.avg_loss))}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Partials</p>
                  <p className="text-[24px] font-semibold text-[#fafafa]">{partialTpTrades}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Partial Rate</p>
                  <p className="text-[24px] font-semibold text-[#60a5fa]">{partialTpRate.toFixed(1)}%</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Partial P/L</p>
                  <p className={`text-[24px] font-semibold ${partialTpRealized >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>${formatMoney(partialTpRealized)}</p>
                </div>
              </div>
            </motion.div>
        )}
      </div>
  );
}