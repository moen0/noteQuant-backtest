import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import { BacktestingTab } from './components/BacktestingTab';
import { OptimizerTab } from './components/OptimizerTab';
import { WalkForwardTab } from './components/WalkForwardTab';
import { motion as Motion } from 'motion/react';

import { Runs } from './pages/Runs';
import { RunDetail } from './pages/RunDetail';
import { Strategies } from './pages/Strategies';
import { Data } from './pages/Data';
import appLogo from './assets/favicon.png';
import { API_BASE_URL, TIMEFRAMES, RR_OPTIONS, STARTING_BALANCE } from './constants';
import { formatMoney, buildEquityCurve, buildTradeMarkers, calculateMaxDrawdown, calculateSharpeRatio } from './utils';
import { SideRail } from './design/SideRail';
import { ContextPanel } from './design/ContextPanel';
import { HeroMetric, MetricFrieze, TabPills, Button, Label, Sweep, ChartReadout } from './design/Primitives';
import { chartTheme, variants as motionVariants } from './design/tokens';
import { generateStrategyName } from './design/strategyName';
import { CommandPalette, useCommandPalette } from './design/CommandPalette';
import { useHashRoute } from './design/useHashRoute';

const DATASET_FALLBACKS = [
  { id: '2024.csv', label: '2024', default: true },
  { id: '2023gj.csv', label: '2023 GJ', default: false },
  { id: 'GBPJPY5.csv', label: 'GBPJPY 5M', default: false },
];

function resolveDatasetLabel(datasets, selectedDataset) {
  return datasets.find((item) => item.id === selectedDataset)?.label ?? selectedDataset;
}

export default function App() {
  const chartContainerRef = useRef(null);
  const equityChartRef = useRef(null);
  const chartRef = useRef(null);
  const equityChartObjRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const equitySeriesRef = useRef(null);
  const markersRef = useRef(null);
  const abortControllerRef = useRef(null);

  const { path: activeTab, query: routeQuery, setPath: setRoutePath, setQuery: setRouteQuery } = useHashRoute();

  const setActiveTab = useCallback(
    (tab) => setRoutePath(tab, routeQuery),
    [routeQuery, setRoutePath]
  );

  const [mounted, setMounted] = useState(false);
  const [timeframe, setTimeframe] = useState(() => Number(routeQuery.tf) || 5);
  const [riskReward, setRiskReward] = useState(() => Number(routeQuery.rr) || 2.5);
  const [showBacktest, setShowBacktest] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState(routeQuery.dataset || '');
  const [compareMode, setCompareMode] = useState(false);
  const [compareDataset, setCompareDataset] = useState('');
  const [chartReadout, setChartReadout] = useState(null);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [chartsReady, setChartsReady] = useState(false);
  const [indicators, setIndicators] = useState({
    structure: true,
    orderBlocks: true,
    fvg: false,
    liquidity: false,
  });
  const [backtestData, setBacktestData] = useState(null);
  const [hasSharedBacktest, setHasSharedBacktest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stratParams] = useState({
    lookback: 7,
    obAge: 50,
    atrMult: 2.5,
    sweep: true,
    sweepLookback: 5,
    session: 'london',
  });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setRouteQuery({
      tf: String(timeframe),
      rr: String(riskReward),
      dataset: selectedDataset || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, riskReward, selectedDataset]);

  useEffect(() => {
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = appLogo;
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadDatasets = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/datasets`);
        const data = await response.json();
        if (!isMounted) return;
        const apiDatasets = Array.isArray(data.datasets) ? data.datasets : [];
        const resolvedDatasets = apiDatasets.length ? apiDatasets : DATASET_FALLBACKS;
        setDatasets(resolvedDatasets);
        setSelectedDataset((current) => {
          const defaultDataset = resolvedDatasets.find((item) => item.default)?.id ?? resolvedDatasets[0]?.id;
          if (!defaultDataset) return current;
          if (resolvedDatasets.some((item) => item.id === current && item.default)) return current;
          if (!resolvedDatasets.some((item) => item.id === current)) return defaultDataset;
          return current;
        });
      } catch {
        if (!isMounted) return;
        setDatasets(DATASET_FALLBACKS);
      }
    };
    loadDatasets();
    return () => { isMounted = false; };
  }, []);

  const toggleIndicator = (key) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBacktestComplete = useCallback((payload) => {
    if (!payload) return;
    setBacktestData(payload);
    setHasSharedBacktest(true);
  }, []);

  const loadData = useCallback(async () => {
    const shouldLoadDashboardData = ['dashboard', 'forex-stats', 'trade-history'].includes(activeTab);
    if (!shouldLoadDashboardData) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const shouldLoadBacktest = showBacktest || activeTab === 'forex-stats';
      const shouldFetchBacktest = shouldLoadBacktest && !hasSharedBacktest;
      const datasetQuery = `dataset=${encodeURIComponent(selectedDataset)}`;
      const fetches = [
        fetch(`${API_BASE_URL}/api/candles?timeframe=${timeframe}&${datasetQuery}`, { signal: controller.signal }),
        fetch(`${API_BASE_URL}/api/indicators?timeframe=${timeframe}&${datasetQuery}`, { signal: controller.signal }),
      ];
      if (shouldFetchBacktest) {
        fetches.push(fetch(`${API_BASE_URL}/api/backtest?timeframe=${timeframe}&rr=${riskReward}&lookback=${stratParams.lookback}&ob_age=${stratParams.obAge}&atr_mult=${stratParams.atrMult}&sweep=${stratParams.sweep}&sweep_lookback=${stratParams.sweepLookback}&session=${stratParams.session}&${datasetQuery}`, { signal: controller.signal }));
      }

      const responses = await Promise.all(fetches);
      if (controller.signal.aborted) return;
      const candleData = await responses[0].json();
      const indicatorData = await responses[1].json();
      const backtestPayload = shouldFetchBacktest
        ? await responses[2].json()
        : (shouldLoadBacktest ? backtestData : null);

      if (controller.signal.aborted) return;
      const candles = candleData.candles.map((candle) => ({
        time: Math.floor(new Date(candle.time).getTime() / 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      candleSeriesRef.current?.setData(candles);

      const times = indicatorData.candle_times;
      const unixTimes = times.map((t) => Math.floor(new Date(t).getTime() / 1000));
      const markers = [];

      if (indicators.structure) {
        indicatorData.structure.forEach((swing) => {
          if (swing.index < times.length) {
            markers.push({
              time: unixTimes[swing.index],
              position: swing.type === 'high' ? 'aboveBar' : 'belowBar',
              color: swing.label === 'HH' || swing.label === 'HL' ? '#10b981' : '#ef4444',
              shape: swing.type === 'high' ? 'arrowDown' : 'arrowUp',
              text: swing.label,
            });
          }
        });
      }

      if (indicators.orderBlocks) {
        indicatorData.order_blocks.forEach((ob) => {
          if (ob.index < times.length) {
            markers.push({
              time: unixTimes[ob.index],
              position: ob.type === 'bullish' ? 'belowBar' : 'aboveBar',
              color: ob.type === 'bullish' ? '#3b82f6' : '#f59e0b',
              shape: 'square',
              text: 'OB',
            });
          }
        });
      }

      if (indicators.fvg) {
        indicatorData.fvgs.forEach((fvg) => {
          if (fvg.index < times.length) {
            markers.push({
              time: unixTimes[fvg.index],
              position: fvg.type === 'bullish' ? 'belowBar' : 'aboveBar',
              color: '#a855f7',
              shape: 'circle',
              text: 'FVG',
            });
          }
        });
      }

      if (indicators.liquidity) {
        indicatorData.liquidity.forEach((liq) => {
          liq.indexes.forEach((index) => {
            if (index < times.length) {
              markers.push({
                time: unixTimes[index],
                position: liq.type === 'equal_highs' ? 'aboveBar' : 'belowBar',
                color: '#06b6d4',
                shape: 'circle',
                text: liq.type === 'equal_highs' ? 'EQH' : 'EQL',
              });
            }
          });
        });
      }

      if (backtestPayload?.trades) {
        markers.push(...buildTradeMarkers(backtestPayload.trades));
      }

      markers.sort((a, b) => a.time - b.time);
      markersRef.current?.setMarkers([]);
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      chartRef.current?.timeScale().fitContent();

      if (backtestPayload?.trades?.length) {
        const sortedTrades = backtestPayload.trades.slice().sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
        let equity = STARTING_BALANCE;
        const equityData = sortedTrades.map((trade) => {
          equity += trade.pnl;
          return {
            time: Math.floor(new Date(trade.exit_time).getTime() / 1000),
            value: Number(equity.toFixed(2)),
          };
        });
        equitySeriesRef.current?.setData(equityData);
        equityChartObjRef.current?.timeScale().fitContent();
      } else {
        equitySeriesRef.current?.setData([]);
      }

      if (shouldFetchBacktest) {
        setBacktestData(backtestPayload);
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Failed to load data:', error);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [activeTab, hasSharedBacktest, indicators, riskReward, selectedDataset, showBacktest, timeframe]);

  useEffect(() => {
    setHasSharedBacktest(false);
  }, [selectedDataset]);

  useEffect(() => {
    if (chartRef.current && candleSeriesRef.current) loadData();
  }, [loadData, chartsReady]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 420,
      ...chartTheme,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#FAFAFA',
      downColor: '#404040',
      borderVisible: false,
      wickUpColor: '#FAFAFA',
      wickDownColor: '#404040',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setChartReadout(null);
        return;
      }
      const data = param.seriesData.get(candleSeries);
      if (!data) {
        setChartReadout(null);
        return;
      }
      const dateStr = new Date(param.time * 1000).toISOString().slice(0, 10);
      setChartReadout([
        { label: 'Date', value: dateStr },
        { label: 'O', value: data.open?.toFixed(5) ?? '—' },
        { label: 'H', value: data.high?.toFixed(5) ?? '—' },
        { label: 'L', value: data.low?.toFixed(5) ?? '—' },
        { label: 'C', value: data.close?.toFixed(5) ?? '—' },
      ]);
    });

    if (equityChartRef.current) {
      const equityChart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 120,
        ...chartTheme,
        layout: { ...chartTheme.layout, fontSize: 9 },
      });

      equityChartObjRef.current = equityChart;
      equitySeriesRef.current = equityChart.addSeries(LineSeries, {
        color: '#FAFAFA',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
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

  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    let secondaryFrame = 0;
    const primaryFrame = requestAnimationFrame(() => {
      secondaryFrame = requestAnimationFrame(() => {
        if (chartRef.current && chartContainerRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
          chartRef.current.timeScale().fitContent();
        }
        if (showBacktest && equityChartObjRef.current && equityChartRef.current) {
          equityChartObjRef.current.applyOptions({ width: equityChartRef.current.clientWidth });
          equityChartObjRef.current.timeScale().fitContent();
        }
      });
    });
    return () => { cancelAnimationFrame(primaryFrame); cancelAnimationFrame(secondaryFrame); };
  }, [activeTab, showBacktest]);

  const backtestTrades = backtestData?.trades ?? [];
  const backtestStats = backtestData?.stats ?? null;
  const equityCurve = useMemo(() => buildEquityCurve(backtestTrades), [backtestTrades]);
  const maxDrawdown = useMemo(() => {
    if (backtestStats?.max_drawdown_pct != null) {
      return -Math.abs(backtestStats.max_drawdown_pct);
    }
    return calculateMaxDrawdown(equityCurve);
  }, [backtestStats, equityCurve]);
  const sharpeRatio = useMemo(() => {
    if (backtestStats?.sharpe_ratio != null) {
      return backtestStats.sharpe_ratio;
    }
    return calculateSharpeRatio(backtestTrades);
  }, [backtestStats, backtestTrades]);
  const largestWin = useMemo(() => backtestTrades.reduce((best, t) => Math.max(best, t.pnl), 0), [backtestTrades]);
  const largestLoss = useMemo(() => backtestTrades.reduce((worst, t) => Math.min(worst, t.pnl), 0), [backtestTrades]);
  const grossProfit = backtestStats ? backtestStats.winners * backtestStats.avg_win : 0;
  const grossLoss = backtestStats ? Math.abs(backtestStats.losers * backtestStats.avg_loss) : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
  const netPnl = backtestStats?.total_pnl ?? 0;
  const winRate = backtestStats?.win_rate ?? 0;
  const totalTrades = backtestStats?.total_trades ?? 0;
  const avgWin = backtestStats?.avg_win ?? 0;
  const avgLoss = backtestStats?.avg_loss ?? 0;
  const partialTpRate = backtestStats?.partial_tp_rate ?? 0;
  const selectedDatasetLabel = resolveDatasetLabel(datasets, selectedDataset);

  const containerVariants = motionVariants.container;
  const itemVariants = motionVariants.item;

  const OVERLAY_ITEMS = [
    { key: 'structure', label: 'Structure' },
    { key: 'orderBlocks', label: 'Order Blocks' },
    { key: 'fvg', label: 'FVG' },
    { key: 'liquidity', label: 'Liquidity' },
  ];

  const cumulativeReturnPct = ((netPnl / STARTING_BALANCE) * 100);
  const finalMultiple = 1 + (netPnl / STARTING_BALANCE);

  const frieze = [
    { label: 'Net P/L', numeric: netPnl, format: (v) => `$${formatMoney(v)}` },
    { label: 'Win Rate', numeric: winRate, format: (v) => `${v.toFixed(1)}%` },
    { label: 'Sharpe', numeric: sharpeRatio, format: (v) => v.toFixed(2) },
    { label: 'Max DD', numeric: maxDrawdown, format: (v) => `${v.toFixed(1)}%` },
    { label: 'Profit Factor', numeric: profitFactor, format: (v) => v.toFixed(2) },
    { label: 'Trades', numeric: totalTrades, format: (v) => Math.round(v).toString() },
    { label: 'Avg Win', numeric: avgWin, format: (v) => `$${formatMoney(v)}` },
    { label: 'Avg Loss', numeric: avgLoss, format: (v) => `$${formatMoney(v)}` },
  ];

  const parameters = [
    { label: 'Timeframe', value: `${timeframe}m` },
    { label: 'Risk : Reward', value: `1 : ${riskReward}` },
    { label: 'Lookback', value: `${stratParams.lookback}` },
    { label: 'OB max age', value: `${stratParams.obAge}` },
    { label: 'ATR mult', value: `${stratParams.atrMult}` },
    { label: 'Session', value: stratParams.session },
  ];

  const attribution = [
    { label: 'Winners', value: backtestStats?.winners ?? '—', positive: true },
    { label: 'Losers', value: backtestStats?.losers ?? '—', positive: false },
    { label: 'Largest Win', value: `$${formatMoney(largestWin)}`, positive: true },
    { label: 'Largest Loss', value: `$${formatMoney(largestLoss)}`, positive: false },
    { label: 'Partial TP', value: `${partialTpRate.toFixed(1)}%`, positive: true },
  ];

  const runId = useMemo(() => `R-${Math.floor(1000 + Math.random() * 9000)}`, []);
  const nowStr = new Date().toISOString().slice(11, 16) + ' UTC';

  const strategyName = useMemo(
    () => generateStrategyName({
      session: stratParams.session,
      riskReward,
      timeframe,
      lookback: stratParams.lookback,
      atrMult: stratParams.atrMult,
    }),
    [stratParams.session, stratParams.lookback, stratParams.atrMult, riskReward, timeframe]
  );

  const commands = useMemo(() => {
    const navCmds = [
      { id: 'nav-dashboard', group: 'Navigate', label: 'Dashboard', hint: '⌘1', action: () => setActiveTab('dashboard') },
      { id: 'nav-strategies', group: 'Navigate', label: 'Strategies', hint: '⌘2', action: () => setActiveTab('strategies') },
      { id: 'nav-runs', group: 'Navigate', label: 'Runs', hint: '⌘3', action: () => setActiveTab('runs') },
      { id: 'nav-backtest', group: 'Navigate', label: 'Backtest', hint: '⌘4', action: () => setActiveTab('backtest') },
      { id: 'nav-optimize', group: 'Navigate', label: 'Optimize', hint: '⌘5', action: () => setActiveTab('optimize') },
      { id: 'nav-walk', group: 'Navigate', label: 'Walk-Forward', hint: '⌘6', action: () => setActiveTab('walk-forward') },
      { id: 'nav-data', group: 'Navigate', label: 'Data', hint: '⌘7', action: () => setActiveTab('data') },
    ];
    const datasetCmds = datasets.map((d) => ({
      id: `ds-${d.id}`,
      group: 'Dataset',
      label: d.label,
      hint: d.id,
      action: () => setSelectedDataset(d.id),
    }));
    const actionCmds = [
      { id: 'act-run', group: 'Action', label: 'Run Backtest', hint: 'Enter', action: () => loadData() },
      {
        id: 'act-compare',
        group: 'Action',
        label: compareMode ? 'Exit Compare Mode' : 'Enter Compare Mode',
        action: () => setCompareMode((v) => !v),
      },
    ];
    return [...navCmds, ...actionCmds, ...datasetCmds];
  }, [datasets, compareMode, setActiveTab]);

  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'strategies', label: 'Strategies' },
    { id: 'runs', label: 'Runs' },
    { id: 'backtest', label: 'Backtest' },
    { id: 'optimize', label: 'Optimize' },
    { id: 'walk-forward', label: 'Walk-Forward' },
    { id: 'data', label: 'Data' },
  ];

  const rawPrimary = activeTab?.startsWith('runs/') ? 'runs' : activeTab;
  const knownIds = new Set(TABS.map((t) => t.id));
  const primaryTabId = knownIds.has(rawPrimary) ? rawPrimary : 'dashboard';
  const runDetailId = activeTab?.startsWith('runs/') ? activeTab.slice(5) : null;

  return (
    <div className="min-h-screen bg-black text-[#FAFAFA] font-sans antialiased">
      <SideRail activeTab={activeTab} onTabChange={setActiveTab} version="v4" />

      <div className="pl-16">
        <Motion.main
          variants={containerVariants}
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
          className="max-w-[1600px] mx-auto px-12 py-10"
        >
          {/* Top meta row */}
          <Motion.div variants={itemVariants} className="flex items-start justify-between gap-8 mb-10 flex-wrap">
            <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.22em] text-[#525252]">
              <span>Backtest</span>
              <span className="text-[#262626]">·</span>
              <span>{runId}</span>
              <span className="text-[#262626]">·</span>
              <span>{loading ? 'Running…' : `Completed ${nowStr}`}</span>
            </div>

            <div className="flex items-center gap-10">
              <TabPills
                id="timeframe-pills"
                options={TIMEFRAMES.map((t) => ({ label: t.label, value: t.value }))}
                value={timeframe}
                onChange={setTimeframe}
              />
              <select
                className="bg-transparent border-b border-[#262626] text-[11px] uppercase tracking-[0.18em] text-[#737373] py-1 outline-none focus:border-[#525252] font-normal"
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <button
                onClick={() => setCompareMode((v) => !v)}
                className={`text-[11px] uppercase tracking-[0.18em] transition-colors pb-1 border-b ${
                  compareMode ? 'text-[#FAFAFA] border-[#FAFAFA]' : 'text-[#525252] border-transparent hover:text-[#A3A3A3]'
                }`}
              >
                Compare
              </button>
              <Button variant="primary" onClick={loadData}>Run Backtest</Button>
            </div>
          </Motion.div>

          {/* Global tab pills (secondary) */}
          <Motion.div variants={itemVariants} className="mb-14">
            <TabPills
              id="main-tabs"
              options={TABS.map((t) => ({ label: t.label, value: t.id }))}
              value={primaryTabId}
              onChange={setActiveTab}
              size="sm"
            />
          </Motion.div>

          {/* Dashboard */}
          {primaryTabId === 'dashboard' && (
            <div className="flex gap-16 items-start flex-wrap lg:flex-nowrap">
              <div className="flex-1 min-w-0">
                <Motion.div variants={itemVariants} className="mb-4">
                  <h1 className="text-[44px] leading-[1.05] font-light tracking-[-0.02em] max-w-[720px]">
                    {strategyName}
                  </h1>
                  <div className="flex gap-6 text-[12px] text-[#737373] mt-4">
                    <span>{selectedDatasetLabel || '—'}</span>
                    <span className="text-[#262626]">/</span>
                    <span>{timeframe}m candles</span>
                    <span className="text-[#262626]">/</span>
                    <span>1:{riskReward} R:R</span>
                    {compareMode && (
                      <>
                        <span className="text-[#262626]">/</span>
                        <span className="text-[#FAFAFA]">Compare mode</span>
                      </>
                    )}
                  </div>
                </Motion.div>

                <div className="mt-12 mb-10">
                  <HeroMetric
                    value={`${finalMultiple.toFixed(2)}x`}
                    caption={`${cumulativeReturnPct >= 0 ? '+' : ''}${cumulativeReturnPct.toFixed(1)}% cumulative · net of costs`}
                  />
                </div>

                <Motion.div variants={itemVariants} className="mb-3 flex items-center justify-between gap-6">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-px bg-[#FAFAFA]" />
                      <Label>Strategy</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-px bg-[#404040]" />
                      <Label>Benchmark</Label>
                    </div>
                  </div>
                  <ChartReadout readout={chartReadout} />
                </Motion.div>

                <Motion.div variants={itemVariants} className="mb-2">
                  <Sweep active={loading} />
                </Motion.div>

                <Motion.section variants={itemVariants} className={compareMode ? 'grid grid-cols-2 gap-8' : ''}>
                  <div ref={chartContainerRef} className="h-[420px] w-full" />
                  {compareMode && (
                    <div className="h-[420px] w-full border-l border-[#141414] pl-8 flex items-center justify-center text-[12px] text-[#525252]">
                      <div className="text-center">
                        <div className="mb-3">Compare slot</div>
                        <select
                          value={compareDataset}
                          onChange={(e) => setCompareDataset(e.target.value)}
                          className="bg-transparent border-b border-[#262626] text-[11px] uppercase tracking-[0.18em] text-[#737373] py-1 outline-none focus:border-[#525252]"
                        >
                          <option value="">Select dataset…</option>
                          {datasets.filter((d) => d.id !== selectedDataset).map((d) => (
                            <option key={d.id} value={d.id}>{d.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </Motion.section>

                {showBacktest && (
                  <Motion.section variants={itemVariants} className="mt-10">
                    <Label className="block mb-4">Drawdown</Label>
                    <div ref={equityChartRef} className="h-[120px] w-full" />
                  </Motion.section>
                )}

                <MetricFrieze metrics={frieze} />

                <Motion.div variants={itemVariants} className="mt-10 flex flex-wrap gap-8">
                  <div className="flex items-center gap-4">
                    <Label>R:R</Label>
                    <div className="flex gap-3">
                      {RR_OPTIONS.map((rr) => (
                        <button
                          key={rr}
                          onClick={() => setRiskReward(rr)}
                          className={`text-[12px] font-mono transition-colors ${
                            riskReward === rr ? 'text-[#FAFAFA]' : 'text-[#525252] hover:text-[#A3A3A3]'
                          }`}
                        >
                          1:{rr}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Label>Overlays</Label>
                    <div className="flex gap-4">
                      {OVERLAY_ITEMS.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => toggleIndicator(item.key)}
                          className={`text-[11px] uppercase tracking-[0.12em] transition-colors ${
                            indicators[item.key] ? 'text-[#FAFAFA]' : 'text-[#3A3A3A] hover:text-[#737373]'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowBacktest((v) => !v)}
                        className={`text-[11px] uppercase tracking-[0.12em] transition-colors ${
                          showBacktest ? 'text-[#FAFAFA]' : 'text-[#3A3A3A] hover:text-[#737373]'
                        }`}
                      >
                        Trades
                      </button>
                    </div>
                  </div>
                </Motion.div>
              </div>

              <ContextPanel parameters={parameters} attribution={attribution} />
            </div>
          )}

          {primaryTabId === 'strategies' && (
            <Strategies onRunStrategy={() => setActiveTab('backtest')} />
          )}

          {primaryTabId === 'runs' && !runDetailId && (
            <Runs onOpenRun={(id) => setActiveTab(`runs/${id}`)} />
          )}

          {primaryTabId === 'runs' && runDetailId && (
            <RunDetail runId={runDetailId} onBack={() => setActiveTab('runs')} />
          )}

          {primaryTabId === 'data' && (
            <Data
              datasets={datasets}
              selectedDataset={selectedDataset}
              onSelect={(id) => { setSelectedDataset(id); setActiveTab('dashboard'); }}
            />
          )}

          {primaryTabId === 'backtest' && (
            <Motion.div variants={itemVariants}>
              <BacktestingTab
                datasets={datasets}
                selectedDataset={selectedDataset}
                onDatasetChange={setSelectedDataset}
                onBacktestComplete={handleBacktestComplete}
              />
            </Motion.div>
          )}

          {primaryTabId === 'optimize' && (
            <Motion.div variants={itemVariants}>
              <OptimizerTab
                datasets={datasets}
                selectedDataset={selectedDataset}
                onDatasetChange={setSelectedDataset}
              />
            </Motion.div>
          )}

          {primaryTabId === 'walk-forward' && (
            <Motion.div variants={itemVariants}>
              <WalkForwardTab
                datasets={datasets}
                selectedDataset={selectedDataset}
                onDatasetChange={setSelectedDataset}
              />
            </Motion.div>
          )}
        </Motion.main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />

      <button
        onClick={() => setPaletteOpen(true)}
        className="fixed bottom-6 right-6 flex items-center gap-2 px-3 py-2 border border-[#262626] bg-black text-[10px] uppercase tracking-[0.18em] text-[#525252] hover:text-[#FAFAFA] hover:border-[#404040] transition-colors"
      >
        <span>⌘K</span>
        <span>Command</span>
      </button>
    </div>
  );

}
