import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import { BacktestingTab } from './components/BacktestingTab';
import { OptimizerTab } from './components/OptimizerTab';
import { TradeHistory } from './components/TradeHistory';
import { motion } from 'motion/react';

import { EquityCurve } from './components/EquityCurve';
import { MetricCard } from './components/MetricCard';
import { PerformanceBreakdown } from './components/PerformanceBreakdown';
import { TradeDistribution } from './components/TradeDistribution';
import appLogo from './assets/favicon.png';

const TIMEFRAMES = [
  { label: '1m', value: 1 },
  { label: '3m', value: 3 },
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1H', value: 60 },
];

const RR_OPTIONS = [1, 1.5, 2, 2.5, 3];
const STARTING_BALANCE = 10000;
const DATASET_FALLBACKS = [
  { id: '2023gj.csv', label: '2023 GJ', default: true },
  { id: 'data1.csv', label: 'Data 1', default: false },
  { id: 'gbpjpy_mars.csv', label: 'Data 3', default: false },
];

function formatMoney(value) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEquityCurve(trades) {
  let equity = STARTING_BALANCE;
  return trades
    .slice()
    .sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time))
    .map((trade) => {
      equity += trade.pnl;
      return {
        date: new Date(trade.exit_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        equity: Number(equity.toFixed(2)),
      };
    });
}

function buildMonthlyReturns(trades) {
  const buckets = new Map();
  trades
    .slice()
    .sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time))
    .forEach((trade) => {
      const date = new Date(trade.exit_time);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets.has(key)) {
        buckets.set(key, { month: date.toLocaleDateString('en-US', { month: 'short' }), pnl: 0 });
      }
      buckets.get(key).pnl += trade.pnl;
    });
  return Array.from(buckets.values()).map((entry) => ({
    month: entry.month,
    returnPct: Number(((entry.pnl / STARTING_BALANCE) * 100).toFixed(1)),
  }));
}

function calculateMaxDrawdown(equityCurve) {
  if (!equityCurve.length) return 0;
  let peak = equityCurve[0].equity;
  let maxDrawdown = 0;
  equityCurve.forEach((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = ((point.equity - peak) / peak) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  });
  return Number(maxDrawdown.toFixed(1));
}

function calculateSharpeRatio(trades) {
  if (trades.length < 2) return 0;
  const returns = trades.map((trade) => trade.pnl / STARTING_BALANCE);
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (!stdDev) return 0;
  return Number(((mean / stdDev) * Math.sqrt(trades.length)).toFixed(2));
}

function resolveDatasetLabel(datasets, selectedDataset) {
  return datasets.find((item) => item.id === selectedDataset)?.label ?? selectedDataset;
}

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

export default function App() {
  const chartContainerRef = useRef(null);
  const equityChartRef = useRef(null);
  const chartRef = useRef(null);
  const equityChartObjRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const equitySeriesRef = useRef(null);
  const markersRef = useRef(null);

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [timeframe, setTimeframe] = useState(5);
  const [riskReward, setRiskReward] = useState(2.5);
  const [showBacktest, setShowBacktest] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('data.csv');
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
        const response = await fetch('http://localhost:8000/api/datasets');
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
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const shouldLoadBacktest = showBacktest || activeTab === 'forex-stats';
      const shouldFetchBacktest = shouldLoadBacktest && !hasSharedBacktest;
      const datasetQuery = `dataset=${encodeURIComponent(selectedDataset)}`;
      const fetches = [
        fetch(`http://localhost:8000/api/candles?timeframe=${timeframe}&${datasetQuery}`),
        fetch(`http://localhost:8000/api/indicators?timeframe=${timeframe}&${datasetQuery}`),
      ];
      if (shouldFetchBacktest) {
        fetches.push(fetch(`http://localhost:8000/api/backtest?timeframe=${timeframe}&rr=${riskReward}&lookback=${stratParams.lookback}&ob_age=${stratParams.obAge}&atr_mult=${stratParams.atrMult}&sweep=${stratParams.sweep}&sweep_lookback=${stratParams.sweepLookback}&session=${stratParams.session}&${datasetQuery}`));
      }

      const responses = await Promise.all(fetches);
      const candleData = await responses[0].json();
      const indicatorData = await responses[1].json();
      const backtestPayload = shouldFetchBacktest
        ? await responses[2].json()
        : (shouldLoadBacktest ? backtestData : null);

      const candles = candleData.candles.map((candle) => ({
        time: Math.floor(new Date(candle.time).getTime() / 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      candleSeriesRef.current?.setData(candles);

      const times = indicatorData.candle_times;
      const markers = [];

      if (indicators.structure) {
        indicatorData.structure.forEach((swing) => {
          if (swing.index < times.length) {
            markers.push({
              time: Math.floor(new Date(times[swing.index]).getTime() / 1000),
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
              time: Math.floor(new Date(times[ob.index]).getTime() / 1000),
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
              time: Math.floor(new Date(times[fvg.index]).getTime() / 1000),
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
                time: Math.floor(new Date(times[index]).getTime() / 1000),
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
        backtestPayload.trades.forEach((trade) => {
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

      if (backtestPayload?.trades?.length) {
        const equityCurve = buildEquityCurve(backtestPayload.trades);
        const sortedTrades = backtestPayload.trades.slice().sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
        const equityData = equityCurve.map((point, index) => ({
          time: Math.floor(new Date(sortedTrades[index].exit_time).getTime() / 1000),
          value: point.equity,
        }));
        equitySeriesRef.current?.setData(equityData);
        equityChartObjRef.current?.timeScale().fitContent();
      } else {
        equitySeriesRef.current?.setData([]);
      }

      if (shouldFetchBacktest) {
        setBacktestData(backtestPayload);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, backtestData, hasSharedBacktest, indicators, riskReward, selectedDataset, showBacktest, timeframe]);

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
      height: 480,
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
      const equityChart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 180,
        ...CHART_THEME,
        layout: { ...CHART_THEME.layout, fontSize: 10 },
      });

      equityChartObjRef.current = equityChart;
      equitySeriesRef.current = equityChart.addSeries(LineSeries, {
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
  const monthlyReturns = useMemo(() => buildMonthlyReturns(backtestTrades), [backtestTrades]);
  const maxDrawdown = useMemo(() => calculateMaxDrawdown(equityCurve), [equityCurve]);
  const sharpeRatio = useMemo(() => calculateSharpeRatio(backtestTrades), [backtestTrades]);
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

  const overviewMetrics = [
    { label: 'Net P/L', value: `$${formatMoney(netPnl)}`, change: (netPnl / STARTING_BALANCE) * 100, isPositive: netPnl > 0, isPrimary: true },
    { label: 'Win Rate', value: `${winRate.toFixed(1)}%`, isPositive: winRate > 50 },
    { label: 'Profit Factor', value: profitFactor.toFixed(2), isPositive: profitFactor > 1 },
    { label: 'Partial TP %', value: `${partialTpRate.toFixed(1)}%`, isPositive: partialTpRate > 0, neutral: partialTpRate === 0 },
    { label: 'Max Drawdown', value: `${maxDrawdown.toFixed(1)}%`, isPositive: false },
    { label: 'Sharpe Ratio', value: sharpeRatio.toFixed(2), isPositive: sharpeRatio > 1 },
    { label: 'Total Trades', value: totalTrades.toString(), neutral: true },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] } },
  };

  const OVERLAY_ITEMS = [
    { key: 'structure', label: 'Structure', color: '#10b981' },
    { key: 'orderBlocks', label: 'Order Blocks', color: '#3b82f6' },
    { key: 'fvg', label: 'FVG', color: '#a855f7' },
    { key: 'liquidity', label: 'Liquidity', color: '#06b6d4' },
  ];

  return (
    <div className="min-h-screen bg-black text-[#fafafa]">
      <div className="max-w-[1440px] mx-auto px-6 py-8">

        {/* Header */}
        <motion.header
          className="flex justify-between items-center gap-4 mb-8 flex-wrap"
          variants={itemVariants}
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
        >
          <div className="flex items-center gap-4">
            <img
              src={appLogo}
              alt="noteQuant logo"
              className="w-10 h-10 object-contain border border-[#262626] bg-black p-1"
            />
            <div>
              <div className="text-[17px] font-semibold tracking-tight">noteQuant</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-2 border border-[#262626] bg-[#0a0a0a] text-[13px] font-mono">
              <span className="text-[#737373]">Dataset</span>
              <span>{selectedDatasetLabel}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border border-[#262626] bg-[#0a0a0a] text-[13px] font-mono">
              <span className="text-[#737373]">Pair</span>
              <span>GBP/JPY</span>
            </div>
            {loading && (
              <div className="w-2 h-2 bg-[#10b981] animate-pulse" />
            )}
          </div>
        </motion.header>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-[#262626] pb-4">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'forex-stats', label: 'Forex Stats' },
            { id: 'trade-history', label: 'Trade History' },
            { id: 'backtesting', label: 'Backtesting' },
            { id: 'optimizer', label: 'Optimizer' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`px-4 py-2 text-[13px] font-semibold font-mono border transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#fafafa] text-black border-[#fafafa]'
                  : 'bg-transparent text-[#737373] border-[#262626] hover:text-[#fafafa] hover:border-[#404040]'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        <motion.div
          className="space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
          style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}
        >
          {/* Toolbar */}
          <motion.div variants={itemVariants} className="p-5 border border-[#262626] bg-[#0a0a0a]">
            <div className="flex flex-wrap gap-6 items-center">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Timeframe</span>
                <div className="flex border border-[#262626]">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      className={`px-3 py-1.5 text-[12px] font-mono transition-colors ${
                        timeframe === tf.value
                          ? 'bg-[#fafafa] text-black'
                          : 'text-[#737373] hover:text-[#fafafa]'
                      }`}
                      onClick={() => setTimeframe(tf.value)}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">R:R</span>
                <div className="flex border border-[#262626]">
                  {RR_OPTIONS.map((rr) => (
                    <button
                      key={rr}
                      className={`px-3 py-1.5 text-[12px] font-mono transition-colors ${
                        riskReward === rr
                          ? 'bg-[#fafafa] text-black'
                          : 'text-[#737373] hover:text-[#fafafa]'
                      }`}
                      onClick={() => setRiskReward(rr)}
                    >
                      1:{rr}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Overlays</span>
                <div className="flex flex-wrap gap-2">
                  {OVERLAY_ITEMS.map((item) => (
                    <button
                      key={item.key}
                      className={`flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono border transition-colors ${
                        indicators[item.key]
                          ? 'border-[#404040] text-[#fafafa]'
                          : 'border-[#262626] text-[#525252]'
                      }`}
                      onClick={() => toggleIndicator(item.key)}
                    >
                      <span
                        className="w-1.5 h-1.5"
                        style={{ background: indicators[item.key] ? item.color : '#525252' }}
                      />
                      {item.label}
                    </button>
                  ))}
                  <button
                    className={`flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono border transition-colors ${
                      showBacktest
                        ? 'border-[#404040] text-[#fafafa]'
                        : 'border-[#262626] text-[#525252]'
                    }`}
                    onClick={() => setShowBacktest((prev) => !prev)}
                  >
                    <span
                      className="w-1.5 h-1.5"
                      style={{ background: showBacktest ? '#fafafa' : '#525252' }}
                    />
                    Trades
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Candlestick Chart */}
          <motion.section variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
            <div className="mb-4">
              <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest mb-1">Market Chart</p>
              <h2 className="text-[20px] font-semibold tracking-tight">Candles with structure and trade markers</h2>
            </div>
            <div ref={chartContainerRef} className="h-[480px] border border-[#1a1a1a] overflow-hidden" />
          </motion.section>

          {/* Equity Line (lightweight-charts) */}
          {showBacktest && (
            <motion.section variants={itemVariants} className="border border-[#262626] bg-[#0a0a0a] p-6">
              <div className="mb-4">
                <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest mb-1">Equity Curve</p>
                <h2 className="text-[20px] font-semibold tracking-tight">Strategy balance progression</h2>
              </div>
              <div ref={equityChartRef} className="h-[180px] border border-[#1a1a1a] overflow-hidden" />
            </motion.section>
          )}
        </motion.div>

        {/* Stats Tab */}
        <motion.div
          className="space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
          style={{ display: activeTab === 'forex-stats' ? 'block' : 'none' }}
        >
          {/* Hero */}
          <motion.section variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-[1.7fr_0.9fr] gap-6 p-8 border border-[#262626] bg-[#0a0a0a]">
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 flex-wrap text-[13px] font-mono">
              </div>
            </div>
            <div className="flex flex-col justify-center gap-3 p-5 border border-[#262626] bg-black">
              <span className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Dataset</span>
              <select
                className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-sm p-3 outline-none focus:border-[#404040] transition-colors"
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-[#525252] font-mono">Switch CSVs here to refresh all metrics and charts.</p>
            </div>
          </motion.section>
          
          {/* Metrics Grid */}
          <motion.section variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {overviewMetrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                change={metric.change}
                isPositive={metric.isPositive}
                isPrimary={metric.isPrimary}
                neutral={metric.neutral}
              />
            ))}
          </motion.section>

          {/* Equity Curve (recharts) */}
          <motion.section variants={itemVariants}>
            <EquityCurve data={equityCurve} startingBalance={STARTING_BALANCE} />
          </motion.section>

          {/* Distribution + Breakdown */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TradeDistribution
              wins={backtestStats?.winners ?? 0}
              losses={backtestStats?.losers ?? 0}
              avgWin={avgWin}
              avgLoss={avgLoss}
              largestWin={largestWin}
              largestLoss={largestLoss}
            />
            <PerformanceBreakdown
              monthlyReturns={monthlyReturns}
              largestWin={largestWin}
              largestLoss={largestLoss}
              maxDrawdown={maxDrawdown}
              sharpeRatio={sharpeRatio}
            />
          </motion.div>
        </motion.div>

        {/* Trade History Tab */}
        <motion.div
          className="space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
          style={{ display: activeTab === 'trade-history' ? 'block' : 'none' }}
        >
          <motion.section variants={itemVariants}>
            <TradeHistory trades={backtestTrades} />
          </motion.section>
        </motion.div>

        {/* Backtesting Tab */}
        {activeTab === 'backtesting' && (
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate={mounted ? 'visible' : 'hidden'}
            >
              <BacktestingTab
                  datasets={datasets}
                  selectedDataset={selectedDataset}
                  onDatasetChange={setSelectedDataset}
                  onBacktestComplete={handleBacktestComplete}
              />
            </motion.div>
        )}

        {activeTab === 'optimizer' && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate={mounted ? 'visible' : 'hidden'}
          >
            <OptimizerTab
              datasets={datasets}
              selectedDataset={selectedDataset}
              onDatasetChange={setSelectedDataset}
            />
          </motion.div>
        )}
      </div>
    </div>
  );

}
