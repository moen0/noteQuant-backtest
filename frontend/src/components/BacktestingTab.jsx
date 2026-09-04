import { useCallback, useEffect, useRef, useState } from 'react';
import { motion as Motion } from 'motion/react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import { API_BASE_URL, TIMEFRAMES, RR_OPTIONS, STARTING_BALANCE, CHART_THEME } from '../constants';
import { formatMoney, buildTradeMarkers, calculateProfitFactor, calculateMaxDrawdownFromTrades } from '../utils';
import { NumberInput } from './NumberInput';
import { appendRun, upsertStrategy, markStrategyRun } from '../design/storage';
import { Label, Button, MetricFrieze, Sweep, DataRow, TabPills } from '../design/Primitives';
const SESSIONS = ['london', 'new_york', 'asian', 'london_close', 'london_ny_overlap', 'all'];
const DAYS = [
  { label: 'Mon', value: 0 },
  { label: 'Tue', value: 1 },
  { label: 'Wed', value: 2 },
  { label: 'Thu', value: 3 },
  { label: 'Fri', value: 4 },
];
const PRESETS_KEY = 'nq_backtest_presets';
const RESULT_HISTORY_KEY = 'nq_backtest_recent_results';
const RESULT_HISTORY_LIMIT = 10;
const DEFAULT_PRESET_NAME = 'Manual';

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
    return Array.isArray(parsed) ? parsed.slice(0, RESULT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecentResults(results) {
  localStorage.setItem(RESULT_HISTORY_KEY, JSON.stringify(results.slice(0, RESULT_HISTORY_LIMIT)));
}

function ToggleInput({ label, value, onChange }) {
  return (
      <button
          className={`flex items-center gap-3 px-3 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors ${
              value ? 'text-[#FAFAFA]' : 'text-[#525252] hover:text-[#A3A3A3]'
          }`}
          onClick={() => onChange(!value)}
      >
        <span className={`w-2 h-2 border ${value ? 'bg-[#FAFAFA] border-[#FAFAFA]' : 'border-[#404040]'}`} />
        {label}
      </button>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
      <div className="mb-6 pb-3 border-b border-[#141414]">
        <Label>{title}</Label>
        {subtitle && <p className="text-[11px] text-[#737373] font-mono mt-2">{subtitle}</p>}
      </div>
  );
}

function SegmentButton({ options, value, onChange }) {
  return (
    <div className="flex gap-4">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-[12px] font-mono transition-colors capitalize ${
            value === opt.value ? 'text-[#FAFAFA]' : 'text-[#525252] hover:text-[#A3A3A3]'
          }`}
        >
          {opt.label}
        </button>
      ))}
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
  const eventSourceRef = useRef(null);
  const streamedTradesRef = useRef([]);

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

  const [slippage, setSlippage] = useState(0.0);
  const [spread, setSpread] = useState(0.0);
  const [intrabarPolicy, setIntrabarPolicy] = useState('stop_first');

  // Presets
  const [presets, setPresets] = useState(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [activePresetName, setActivePresetName] = useState(DEFAULT_PRESET_NAME);
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
    slippage, spread, intrabarPolicy,
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
    if (s.slippage !== undefined) setSlippage(s.slippage);
    if (s.spread !== undefined) setSpread(s.spread);
    if (s.intrabarPolicy !== undefined) setIntrabarPolicy(s.intrabarPolicy);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const updated = { ...presets, [name]: getSettings() };
    setPresets(updated);
    savePresets(updated);
    setActivePresetName(name);
    setPresetName('');
  };

  const handleLoadPreset = (name) => {
    const preset = presets[name];
    if (preset) {
      applySettings(preset);
      setActivePresetName(name);
    }
    setShowPresets(false);
  };

  const handleDeletePreset = (name) => {
    const updated = { ...presets };
    delete updated[name];
    setPresets(updated);
    savePresets(updated);
    if (activePresetName === name) {
      setActivePresetName(DEFAULT_PRESET_NAME);
    }
  };

  const exportRunParameters = (run) => {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      runId: run.id,
      presetName: run.presetName || DEFAULT_PRESET_NAME,
      parameters: run.settings || {
        timeframe: run.timeframe,
        riskReward: run.riskReward,
      },
      queryParameters: run.queryParameters || null,
      summary: {
        dataset: run.dataset,
        timeframe: run.timeframe,
        riskReward: run.riskReward,
        totalPnl: run.totalPnl,
        winRate: run.winRate,
        totalTrades: run.totalTrades,
      },
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safePreset = (run.presetName || DEFAULT_PRESET_NAME).replace(/[^a-z0-9_-]/gi, '_');
    anchor.href = url;
    anchor.download = `backtest-params-${run.dataset || 'dataset'}-${safePreset}-${run.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
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
      eventSourceRef.current?.close();
    };
  }, []);

  const runBacktest = useCallback(async () => {
    if (!chartsReady) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (progressResetTimeoutRef.current) clearTimeout(progressResetTimeoutRef.current);

    setProgressPct(0);
    setLoading(true);
    streamedTradesRef.current = [];
    markersRef.current?.setMarkers([]);
    equitySeriesRef.current?.setData([]);

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
      intrabar_policy: intrabarPolicy,
      slippage: slippage.toString(),
      spread: spread.toString(),
    });

    const streamUrl = `${API_BASE_URL}/api/backtest/stream?${params}`;
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    fetch(`${API_BASE_URL}/api/candles?timeframe=${timeframe}&dataset=${encodeURIComponent(selectedDataset)}`)
      .then((res) => res.json())
      .then((candleData) => {
        const candles = candleData.candles.map((c) => ({
          time: Math.floor(new Date(c.time).getTime() / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        candleSeriesRef.current?.setData(candles);
        chartRef.current?.timeScale().fitContent();
      })
      .catch((err) => console.error('Failed to load candles:', err));

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgressPct(data.progress_pct || 0);
        } else if (data.type === 'trade') {
          const trade = data.trade;
          streamedTradesRef.current.push(trade);

          const markers = buildTradeMarkers(streamedTradesRef.current);
          markers.sort((a, b) => a.time - b.time);
          markersRef.current?.setMarkers([]);
          markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);

          const sortedTrades = streamedTradesRef.current.slice().sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
          let eq = STARTING_BALANCE;
          const eqData = sortedTrades.map((t) => {
            eq += t.pnl;
            return { time: Math.floor(new Date(t.exit_time).getTime() / 1000), value: Number(eq.toFixed(2)) };
          });
          equitySeriesRef.current?.setData(eqData);

          setResults({ trades: streamedTradesRef.current, stats: data.stats });
        } else if (data.type === 'done') {
          es.close();
          eventSourceRef.current = null;

          const backtestData = { trades: data.trades, stats: data.stats, overfitting: data.overfitting };
          setResults(backtestData);
          onBacktestComplete?.(backtestData);

          if (data.stats) {
            const snapshotSettings = { ...getSettings(), dayFilter: [...dayFilter] };
            const snapshot = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              runAt: new Date().toISOString(),
              dataset: selectedDataset,
              presetName: activePresetName,
              strategyName: activePresetName,
              timeframe,
              riskReward,
              settings: snapshotSettings,
              queryParameters: Object.fromEntries(params.entries()),
              totalPnl: Number(data.stats.total_pnl ?? 0),
              winRate: Number(data.stats.win_rate ?? 0),
              totalTrades: Number(data.stats.total_trades ?? 0),
              stats: data.stats,
              trades: data.trades,
            };
            setRecentResults((prev) => {
              const next = [snapshot, ...prev].slice(0, RESULT_HISTORY_LIMIT);
              saveRecentResults(next);
              return next;
            });
            appendRun(snapshot);
            if (activePresetName && activePresetName !== DEFAULT_PRESET_NAME) {
              upsertStrategy({ name: activePresetName, settings: snapshotSettings });
              markStrategyRun(activePresetName);
            }
          }

          setProgressPct(100);
          setLoading(false);
          progressResetTimeoutRef.current = setTimeout(() => setProgressPct(0), 500);
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setProgressPct(0);
      console.error('Backtest stream error');
    };
  }, [
    chartsReady, timeframe, riskReward, lookback, atrMult, session,
    useFvg, useOb, useLiquiditySweep, sweepLookback, obMaxAge,
    selectedDataset, proximityPct, minGapSize, impulseMultiplier,
    requireUnmitigatedFvg, requireBosConfluence, minObSize,
    requireFvgObConfluence, asianSweepOnly, dayFilter,
    useBreakEven, beTriggerRr,
    usePartialTp, partialTpRr, partialTpPercent,
    maxDailyLoss, maxConsecutiveLosses,
    slippage, spread, intrabarPolicy,
    onBacktestComplete, activePresetName,
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
      const response = await fetch(`${API_BASE_URL}/api/backtest/monte-carlo`, {
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
          base_max_drawdown_pct: calculateMaxDrawdownFromTrades(results.trades, STARTING_BALANCE),
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
      <div className="space-y-16">
        <Motion.div variants={itemVariants}>
          <div className="flex items-start justify-between gap-6 mb-10 flex-wrap">
            <div>
              <Label>Workspace</Label>
              <h1 className="text-[36px] leading-[1.1] font-light tracking-[-0.02em] mt-3">
                Backtest
              </h1>
              <p className="text-[12px] text-[#737373] mt-3">
                Configure the strategy and execute a single run · trades stream live
              </p>
            </div>
            <div className="flex items-center gap-6">
              <ToggleInput label="Auto Run" value={autoRun} onChange={setAutoRun} />
              <Button variant="ghost" onClick={() => setShowPresets((p) => !p)}>Presets</Button>
              <Button
                variant="outline"
                onClick={runMonteCarlo}
                disabled={loading || mcLoading || !results?.trades?.length}
              >
                {mcLoading ? 'Running MC…' : 'Monte Carlo'}
              </Button>
              <Button variant="primary" onClick={runBacktest} disabled={loading}>
                {loading ? 'Running…' : 'Run Backtest'}
              </Button>
            </div>
          </div>

          <div className="mb-10">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[#525252] mb-2">
              <span>{loading ? 'Running backtest' : 'Ready'}</span>
              <span className="font-mono text-[#737373] tabular-nums">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-px bg-[#141414] relative overflow-hidden">
              <div
                className="h-full bg-[#FAFAFA] transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {loading && <div className="mt-2"><Sweep active /></div>}
          </div>

          {showPresets && (
              <div className="mb-10 pt-8 border-t border-[#141414]">
                <div className="flex items-center justify-between mb-6">
                  <Label>Presets</Label>
                  <button
                      onClick={() => setShowPresets(false)}
                      className="text-[10px] uppercase tracking-[0.18em] text-[#525252] hover:text-[#FAFAFA]"
                  >
                    Close
                  </button>
                </div>

                <div className="flex gap-4 mb-6 items-end">
                  <input
                      type="text"
                      placeholder="Name a preset…"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                      className="flex-1 bg-transparent border-b border-[#262626] text-[13px] text-[#FAFAFA] py-2 outline-none focus:border-[#525252] placeholder:text-[#404040]"
                  />
                  <Button variant="outline" onClick={handleSavePreset} disabled={!presetName.trim()}>
                    Save Current
                  </Button>
                </div>

                {presetNames.length === 0 ? (
                    <p className="text-[12px] text-[#525252]">No saved presets yet.</p>
                ) : (
                    <div>
                      {presetNames.map((name) => (
                          <div key={name} className="flex items-center justify-between py-3 border-b border-[#141414]">
                            <span className="text-[13px] text-[#FAFAFA]">{name}</span>
                            <div className="flex gap-4">
                              <button onClick={() => handleLoadPreset(name)} className="text-[10px] uppercase tracking-[0.18em] text-[#737373] hover:text-[#FAFAFA]">
                                Load
                              </button>
                              <button onClick={() => handleDeletePreset(name)} className="text-[10px] uppercase tracking-[0.18em] text-[#404040] hover:text-[#FAFAFA]">
                                Delete
                              </button>
                            </div>
                          </div>
                      ))}
                    </div>
                )}
              </div>
          )}

          <SectionHeader title="Core Strategy" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6 mb-10">
            <div className="flex items-center justify-between">
              <Label>Timeframe</Label>
              <SegmentButton
                options={TIMEFRAMES.map((tf) => ({ label: tf.label, value: tf.value }))}
                value={timeframe}
                onChange={setTimeframe}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Risk : Reward</Label>
              <SegmentButton
                options={RR_OPTIONS.map((rr) => ({ label: `1:${rr}`, value: rr }))}
                value={riskReward}
                onChange={setRiskReward}
              />
            </div>
            <div className="flex items-center justify-between col-span-1 md:col-span-2">
              <Label>Session</Label>
              <SegmentButton
                options={SESSIONS.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))}
                value={session}
                onChange={setSession}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Dataset</Label>
              <select
                className="bg-transparent border-b border-[#262626] text-[13px] text-[#FAFAFA] py-1 outline-none focus:border-[#525252]"
                value={selectedDataset}
                onChange={(e) => onDatasetChange(e.target.value)}
              >
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

          <div className="mt-12 mb-10" />
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

          <div className="mt-12 mb-10" />
          <SectionHeader title="Order Block Settings" subtitle="Order block quality filters" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <NumberInput label="Min OB Size" value={minObSize} onChange={setMinObSize} min={0} max={0.01} step={0.0001} />
          </div>
          <div className="flex flex-wrap gap-3 mb-6">
            <ToggleInput label="Order Blocks" value={useOb} onChange={setUseOb} />
            <ToggleInput label="Require FVG + OB Confluence" value={requireFvgObConfluence} onChange={setRequireFvgObConfluence} />
          </div>

          <div className="mt-12 mb-10" />
          <SectionHeader title="Liquidity Settings" subtitle="Sweep and liquidity filters" />
          <div className="flex flex-wrap gap-3 mb-6">
            <ToggleInput label="Liquidity Sweep" value={useLiquiditySweep} onChange={setUseLiquiditySweep} />
            <ToggleInput label="Asian Range Sweep Only" value={asianSweepOnly} onChange={setAsianSweepOnly} />
          </div>

          <div className="mt-12 mb-10" />
          <SectionHeader title="Day Filter" subtitle="Select which days to trade" />
          <div className="flex gap-6 mb-10">
            {DAYS.map((d) => (
                <button
                    key={d.value}
                    onClick={() => toggleDay(d.value)}
                    className={`text-[12px] font-mono transition-colors ${
                        dayFilter.includes(d.value) ? 'text-[#FAFAFA]' : 'text-[#525252] hover:text-[#A3A3A3]'
                    }`}
                >
                    {d.label}
                </button>
            ))}
          </div>

          <div className="mt-12 mb-10" />
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

          <div className="mt-12 mb-10" />
          <SectionHeader title="Execution Realism" subtitle="Slippage, spread, and fill policy" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <NumberInput label="Slippage (pips)" value={slippage} onChange={setSlippage} min={0} max={0.005} step={0.0001} />
            <NumberInput label="Spread (pips)" value={spread} onChange={setSpread} min={0} max={0.005} step={0.0001} />
          </div>
          <div className="flex items-center gap-8 mb-10">
            <Label>Intrabar Policy</Label>
            <SegmentButton
              options={[
                { value: 'stop_first', label: 'Stop First' },
                { value: 'target_first', label: 'Target First' },
                { value: 'ohlc_path', label: 'OHLC Path' },
              ]}
              value={intrabarPolicy}
              onChange={setIntrabarPolicy}
            />
          </div>
        </Motion.div>

        <Motion.div variants={itemVariants}>
          <div className="flex items-end justify-between mb-4">
            <Label>Price · trades</Label>
            <span className="text-[11px] font-mono text-[#525252]">{results?.trades?.length ?? 0} trades</span>
          </div>
          <div ref={chartContainerRef} className="h-[420px] w-full" />
        </Motion.div>

        <Motion.div variants={itemVariants}>
          <Label className="block mb-4">Equity curve</Label>
          <div ref={equityChartRef} className="h-[160px] w-full" />
        </Motion.div>

        {stats && (
            <Motion.div variants={itemVariants} className="space-y-12">
              <div>
                <Label>Result</Label>
                <div className="flex items-baseline gap-6 mt-3 flex-wrap">
                  <span className={`text-[48px] leading-none font-light tabular-nums ${totalPnl >= 0 ? 'text-[#FAFAFA]' : 'text-[#737373]'}`}>
                    {totalPnl >= 0 ? '+' : ''}${formatMoney(totalPnl)}
                  </span>
                  <span className="text-[12px] font-mono text-[#737373]">
                    {selectedDataset} · {activePresetName}
                  </span>
                </div>
              </div>

              <MetricFrieze metrics={[
                { label: 'Win Rate', numeric: winRate, format: (v) => `${v.toFixed(1)}%` },
                { label: 'Total Trades', numeric: totalTrades, format: (v) => Math.round(v).toString() },
                { label: 'Winners', numeric: stats.winners, format: (v) => Math.round(v).toString() },
                { label: 'Losers', numeric: stats.losers, format: (v) => Math.round(v).toString() },
                { label: 'Avg Win', numeric: stats.avg_win, format: (v) => `$${formatMoney(v)}` },
                { label: 'Avg Loss', numeric: Math.abs(stats.avg_loss || 0), format: (v) => `$${formatMoney(v)}` },
                { label: 'Partial Rate', numeric: partialTpRate, format: (v) => `${v.toFixed(1)}%` },
                { label: 'Partial P/L', numeric: partialTpRealized, format: (v) => `$${formatMoney(v)}` },
              ]} />

              <div>
                <Label className="block mb-4">Last {RESULT_HISTORY_LIMIT} runs</Label>
                {recentResults.length === 0 ? (
                  <p className="text-[12px] text-[#525252]">No previous runs saved yet.</p>
                ) : (
                  <div>
                    <div className="grid grid-cols-[1.4fr_1.2fr_0.5fr_1fr_0.8fr_0.6fr_0.6fr_0.6fr] gap-4 py-2 border-b border-[#141414]">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">When</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Dataset</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">TF</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Preset</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252] text-right">P/L</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252] text-right">Win %</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252] text-right">Trades</span>
                      <span />
                    </div>
                    {recentResults.map((run) => (
                      <div key={run.id} className="grid grid-cols-[1.4fr_1.2fr_0.5fr_1fr_0.8fr_0.6fr_0.6fr_0.6fr] gap-4 py-3 border-b border-[#141414] items-center">
                        <span className="text-[12px] font-mono text-[#A3A3A3]">{new Date(run.runAt).toLocaleString()}</span>
                        <span className="text-[12px] font-mono text-[#FAFAFA]">{run.dataset || '—'}</span>
                        <span className="text-[12px] font-mono text-[#737373]">{run.timeframe ?? '—'}m</span>
                        <span className="text-[12px] text-[#A3A3A3]">{run.presetName || DEFAULT_PRESET_NAME}</span>
                        <span className={`text-[12px] font-mono tabular-nums text-right ${(run.totalPnl ?? 0) >= 0 ? 'text-[#FAFAFA]' : 'text-[#737373]'}`}>
                          {(run.totalPnl ?? 0) >= 0 ? '+' : ''}${formatMoney(Number(run.totalPnl ?? 0))}
                        </span>
                        <span className="text-[12px] font-mono tabular-nums text-right text-[#A3A3A3]">{Number(run.winRate ?? 0).toFixed(1)}%</span>
                        <span className="text-[12px] font-mono tabular-nums text-right text-[#A3A3A3]">{Number(run.totalTrades ?? 0)}</span>
                        <button
                          onClick={() => exportRunParameters(run)}
                          className="text-[10px] uppercase tracking-[0.18em] text-[#525252] hover:text-[#FAFAFA] text-right"
                        >
                          Export
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-12 mb-10" />
              <div>
                <div className="flex items-end justify-between gap-4 mb-6">
                  <div>
                    <Label>Monte Carlo</Label>
                    <p className="text-[12px] text-[#737373] mt-2">Stress-test the current trade set</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={runMonteCarlo}
                    disabled={mcLoading || !results?.trades?.length}
                  >
                    {mcLoading ? 'Running…' : 'Run Monte Carlo'}
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                  <NumberInput label="Runs" value={mcRuns} onChange={setMcRuns} min={1} step={1} />
                  <NumberInput label="PnL Var %" value={mcVariationPct} onChange={setMcVariationPct} min={0} step={1} />
                  <NumberInput label="Price Noise %" value={mcPriceNoisePct} onChange={setMcPriceNoisePct} min={0} step={1} />
                  <NumberInput label="Slippage" value={mcSlippage} onChange={setMcSlippage} min={0} step={0.01} />
                  <NumberInput label="Spread" value={mcSpread} onChange={setMcSpread} min={0} step={0.01} />
                  <NumberInput label="Ruin DD %" value={mcRuinDrawdownPct} onChange={setMcRuinDrawdownPct} min={0} step={1} />
                </div>

                <label className="inline-flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-[#737373] cursor-pointer">
                  <input
                      type="checkbox"
                      checked={mcShuffleTrades}
                      onChange={(e) => setMcShuffleTrades(e.target.checked)}
                      className="h-3 w-3 accent-white"
                  />
                  Shuffle trade order each simulation run
                </label>

                {mcErrorMessage && (
                    <div className="mt-4 text-[12px] text-[#FAFAFA] border-l-2 border-[#525252] pl-4 py-2">
                      {mcErrorMessage}
                    </div>
                )}

                {mcResult && (
                    <div className="mt-8 space-y-8">
                      <MetricFrieze metrics={[
                        { label: 'Avg PnL', numeric: mcResult.summary?.avg_pnl ?? 0, format: (v) => v.toFixed(2) },
                        { label: 'Profitable %', numeric: mcResult.summary?.profitable_run_pct ?? 0, format: (v) => `${v.toFixed(1)}%` },
                        { label: 'Worst DD %', numeric: mcResult.summary?.worst_max_drawdown_pct ?? 0, format: (v) => `${v.toFixed(1)}%` },
                        { label: 'Avg WR', numeric: mcResult.summary?.avg_win_rate ?? 0, format: (v) => `${v.toFixed(1)}%` },
                        { label: 'Avg PF', numeric: mcResult.summary?.avg_profit_factor ?? 0, format: (v) => v.toFixed(2) },
                        { label: 'Ruin %', numeric: mcResult.summary?.probability_of_ruin ?? 0, format: (v) => `${v.toFixed(1)}%` },
                      ]} />

                      <div>
                        <div className="grid grid-cols-[60px_100px_120px_100px_100px_80px] gap-3 py-2 border-b border-[#141414]">
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Run</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Net PnL</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Max DD %</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Win Rate</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">PF</span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-[#525252]">Ruin</span>
                        </div>
                        {mcRunsData.map((run) => (
                            <div key={run.run} className="grid grid-cols-[60px_100px_120px_100px_100px_80px] gap-3 py-2 text-[12px] font-mono border-b border-[#141414] tabular-nums">
                              <span className="text-[#A3A3A3]">{run.run}</span>
                              <span className={run.net_pnl >= 0 ? 'text-[#FAFAFA]' : 'text-[#737373]'}>{Number(run.net_pnl).toFixed(2)}</span>
                              <span className="text-[#A3A3A3]">{Number(run.max_drawdown_pct).toFixed(2)}</span>
                              <span className="text-[#A3A3A3]">{Number(run.win_rate).toFixed(2)}%</span>
                              <span className="text-[#A3A3A3]">{Number(run.profit_factor).toFixed(2)}</span>
                              <span className={run.ruin ? 'text-[#FAFAFA]' : 'text-[#525252]'}>{run.ruin ? 'Yes' : 'No'}</span>
                            </div>
                        ))}
                      </div>
                    </div>
                )}
              </div>
            </Motion.div>
        )}
      </div>
  );
}


