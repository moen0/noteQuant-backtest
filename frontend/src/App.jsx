import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
} from "lightweight-charts";

const TIMEFRAMES = [
  { label: "1m", value: 1 },
  { label: "3m", value: 3 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1H", value: 60 },
];

const RR_OPTIONS = [1.0, 1.5, 2.0, 2.5, 3.0];

const COLORS = {
  bg: "#0a0a12",
  surface: "#12121e",
  surfaceLight: "#1a1a2e",
  border: "#1e1e35",
  borderLight: "#2a2a45",
  text: "#c8c8d4",
  textDim: "#6a6a80",
  textBright: "#eaeaf0",
  accent: "#6366f1",
  accentDim: "rgba(99, 102, 241, 0.15)",
  bullish: "#22c55e",
  bullishDim: "rgba(34, 197, 94, 0.12)",
  bearish: "#ef4444",
  bearishDim: "rgba(239, 68, 68, 0.12)",
  ob: "#3b82f6",
  obBearish: "#f59e0b",
  fvg: "#a855f7",
  liquidity: "#06b6d4",
  tradeWin: "#22c55e",
  tradeLoss: "#ef4444",
  equity: "#6366f1",
};

function App() {
  const chartContainerRef = useRef(null);
  const equityChartRef = useRef(null);
  const chartRef = useRef(null);
  const equityChartObjRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const markersRef = useRef(null);

  const [timeframe, setTimeframe] = useState(5);
  const [riskReward, setRiskReward] = useState(2.5);
  const [showBacktest, setShowBacktest] = useState(true);
  const [indicators, setIndicators] = useState({
    structure: true,
    orderBlocks: true,
    fvg: false,
    liquidity: false,
  });
  const [stats, setStats] = useState(null);
  const [backtestStats, setBacktestStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const toggleIndicator = (key) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fetches = [
        fetch(`http://localhost:8000/api/candles?timeframe=${timeframe}`),
        fetch(`http://localhost:8000/api/indicators?timeframe=${timeframe}`),
      ];
      if (showBacktest) {
        fetches.push(
            fetch(`http://localhost:8000/api/backtest?timeframe=${timeframe}&rr=${riskReward}`)
        );
      }

      const responses = await Promise.all(fetches);
      const candleData = await responses[0].json();
      const indicatorData = await responses[1].json();
      const backtestData = showBacktest ? await responses[2].json() : null;

      const formatted = candleData.candles.map((c) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(formatted);
      }

      const times = indicatorData.candle_times;
      const markers = [];

      if (indicators.structure) {
        indicatorData.structure.forEach((s) => {
          if (s.index < times.length) {
            markers.push({
              time: Math.floor(new Date(times[s.index]).getTime() / 1000),
              position: s.type === "high" ? "aboveBar" : "belowBar",
              color: s.label === "HH" || s.label === "HL" ? COLORS.bullish : COLORS.bearish,
              shape: s.type === "high" ? "arrowDown" : "arrowUp",
              text: s.label,
            });
          }
        });
      }

      if (indicators.orderBlocks) {
        indicatorData.order_blocks.forEach((ob) => {
          if (ob.index < times.length) {
            markers.push({
              time: Math.floor(new Date(times[ob.index]).getTime() / 1000),
              position: ob.type === "bullish" ? "belowBar" : "aboveBar",
              color: ob.type === "bullish" ? COLORS.ob : COLORS.obBearish,
              shape: "square",
              text: "OB",
            });
          }
        });
      }

      if (indicators.fvg) {
        indicatorData.fvgs.forEach((f) => {
          if (f.index < times.length) {
            markers.push({
              time: Math.floor(new Date(times[f.index]).getTime() / 1000),
              position: f.type === "bullish" ? "belowBar" : "aboveBar",
              color: COLORS.fvg,
              shape: "circle",
              text: "FVG",
            });
          }
        });
      }

      if (indicators.liquidity) {
        indicatorData.liquidity.forEach((l) => {
          l.indexes.forEach((idx) => {
            if (idx < times.length) {
              markers.push({
                time: Math.floor(new Date(times[idx]).getTime() / 1000),
                position: l.type === "equal_highs" ? "aboveBar" : "belowBar",
                color: COLORS.liquidity,
                shape: "circle",
                text: l.type === "equal_highs" ? "EQH" : "EQL",
              });
            }
          });
        });
      }

      if (showBacktest && backtestData && backtestData.trades) {
        backtestData.trades.forEach((t) => {
          const isWin = t.pnl > 0;
          markers.push({
            time: Math.floor(new Date(t.enter_time).getTime() / 1000),
            position: t.direction === "long" ? "belowBar" : "aboveBar",
            color: isWin ? COLORS.tradeWin : COLORS.tradeLoss,
            shape: t.direction === "long" ? "arrowUp" : "arrowDown",
            text: t.direction === "long" ? "BUY" : "SELL",
          });
          markers.push({
            time: Math.floor(new Date(t.exit_time).getTime() / 1000),
            position: "inBar",
            color: isWin ? COLORS.tradeWin : COLORS.tradeLoss,
            shape: "circle",
            text: isWin ? `+${t.pnl.toFixed(2)}` : t.pnl.toFixed(2),
          });
        });

        setBacktestStats(backtestData.stats);

        if (equityChartObjRef.current && backtestData.trades.length > 0) {
          let cumPnl = 0;
          const equityData = backtestData.trades.map((t) => {
            cumPnl += t.pnl;
            return {
              time: Math.floor(new Date(t.exit_time).getTime() / 1000),
              value: parseFloat(cumPnl.toFixed(4)),
            };
          });

          const eChart = equityChartObjRef.current;
          const equitySeries = eChart.addSeries(LineSeries, {
            color: COLORS.equity,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
          });
          equitySeries.setData(equityData);
          eChart.timeScale().fitContent();
        }
      } else {
        setBacktestStats(null);
      }

      markers.sort((a, b) => a.time - b.time);

      if (markersRef.current) {
        markersRef.current.setMarkers([]);
      }
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      chartRef.current.timeScale().fitContent();

      const bullishOB = indicatorData.order_blocks.filter((o) => o.type === "bullish").length;
      const bearishOB = indicatorData.order_blocks.filter((o) => o.type === "bearish").length;

      setStats({
        candles: candleData.candles.length,
        swings: indicatorData.swings.length,
        structure: indicatorData.structure.length,
        orderBlocks: indicatorData.order_blocks.length,
        bullishOB,
        bearishOB,
        fvgs: indicatorData.fvgs.length,
        liquidity: indicatorData.liquidity.length,
      });
    } catch (err) {
      console.error("Failed to load data:", err);
    }
    setLoading(false);
  }, [timeframe, indicators, showBacktest, riskReward]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 480,
      layout: {
        background: { color: COLORS.surface },
        textColor: COLORS.textDim,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: COLORS.border },
        horzLines: { color: COLORS.border },
      },
      crosshair: {
        vertLine: { color: "rgba(99, 102, 241, 0.3)", labelBackgroundColor: COLORS.accent },
        horzLine: { color: "rgba(99, 102, 241, 0.3)", labelBackgroundColor: COLORS.accent },
      },
      rightPriceScale: { borderColor: COLORS.border, textColor: COLORS.textDim },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderVisible: false,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    if (equityChartRef.current) {
      const eChart = createChart(equityChartRef.current, {
        width: equityChartRef.current.clientWidth,
        height: 160,
        layout: {
          background: { color: COLORS.surface },
          textColor: COLORS.textDim,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: COLORS.border },
          horzLines: { color: COLORS.border },
        },
        rightPriceScale: { borderColor: COLORS.border },
        timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
        crosshair: {
          vertLine: { color: "rgba(99, 102, 241, 0.3)", labelBackgroundColor: COLORS.accent },
          horzLine: { color: "rgba(99, 102, 241, 0.3)", labelBackgroundColor: COLORS.accent },
        },
      });
      equityChartObjRef.current = eChart;
    }

    const handleResize = () => {
      if (chartContainerRef.current)
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      if (equityChartRef.current && equityChartObjRef.current)
        equityChartObjRef.current.applyOptions({ width: equityChartRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      if (equityChartObjRef.current) equityChartObjRef.current.remove();
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && candleSeriesRef.current) loadData();
  }, [loadData]);

  return (
      <div style={styles.root}>
        <link
            href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap"
            rel="stylesheet"
        />

        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.logo}>
              <div style={styles.logoIcon}>nQ</div>
              <div>
                <div style={styles.logoTitle}>noteQuant</div>
                <div style={styles.logoSub}>ICT/SMC Backtester</div>
              </div>
            </div>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.pairBadge}>
              <span style={styles.pairFlag}>GBP/JPY</span>
              <span style={styles.pairLabel}>Forex</span>
            </div>
            {loading && <div style={styles.loadingDot} />}
          </div>
        </header>

        <div style={styles.controls}>
          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Timeframe</span>
            <div style={styles.tfGroup}>
              {TIMEFRAMES.map((tf) => (
                  <button
                      key={tf.value}
                      onClick={() => setTimeframe(tf.value)}
                      style={{ ...styles.tfBtn, ...(timeframe === tf.value ? styles.tfBtnActive : {}) }}
                  >
                    {tf.label}
                  </button>
              ))}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>R:R</span>
            <div style={styles.tfGroup}>
              {RR_OPTIONS.map((rr) => (
                  <button
                      key={rr}
                      onClick={() => setRiskReward(rr)}
                      style={{ ...styles.tfBtn, ...(riskReward === rr ? styles.tfBtnActive : {}) }}
                  >
                    1:{rr}
                  </button>
              ))}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Overlays</span>
            <div style={styles.indicatorGroup}>
              {[
                { key: "structure", label: "Structure", color: COLORS.bullish },
                { key: "orderBlocks", label: "Order Blocks", color: COLORS.ob },
                { key: "fvg", label: "FVG", color: COLORS.fvg },
                { key: "liquidity", label: "Liquidity", color: COLORS.liquidity },
              ].map((ind) => (
                  <button
                      key={ind.key}
                      onClick={() => toggleIndicator(ind.key)}
                      style={{
                        ...styles.indBtn,
                        ...(indicators[ind.key]
                            ? { borderColor: ind.color, background: `${ind.color}15`, color: ind.color }
                            : {}),
                      }}
                  >
                <span
                    style={{
                      ...styles.indDot,
                      background: indicators[ind.key] ? ind.color : COLORS.textDim,
                    }}
                />
                    {ind.label}
                  </button>
              ))}
              <button
                  onClick={() => setShowBacktest((prev) => !prev)}
                  style={{
                    ...styles.indBtn,
                    ...(showBacktest
                        ? { borderColor: COLORS.accent, background: COLORS.accentDim, color: COLORS.accent }
                        : {}),
                  }}
              >
              <span
                  style={{ ...styles.indDot, background: showBacktest ? COLORS.accent : COLORS.textDim }}
              />
                Trades
              </button>
            </div>
          </div>
        </div>

        <div style={styles.chartWrapper}>
          <div ref={chartContainerRef} style={styles.chart} />
        </div>

        {showBacktest && (
            <div style={styles.chartWrapper}>
              <div style={styles.sectionLabel}>Equity Curve</div>
              <div ref={equityChartRef} style={styles.chart} />
            </div>
        )}

        {backtestStats && showBacktest && (
            <div style={styles.backtestBar}>
              <div style={styles.backtestTitle}>ICT Strategy Backtest</div>
              <div style={styles.backtestGrid}>
                <div style={styles.btStat}>
                  <span style={styles.btValue}>{backtestStats.total_trades}</span>
                  <span style={styles.btLabel}>Trades</span>
                </div>
                <div style={styles.btStat}>
              <span style={{ ...styles.btValue, color: backtestStats.win_rate >= 50 ? COLORS.bullish : COLORS.bearish }}>
                {backtestStats.win_rate.toFixed(1)}%
              </span>
                  <span style={styles.btLabel}>Win Rate</span>
                </div>
                <div style={styles.btStat}>
              <span style={{ ...styles.btValue, color: backtestStats.total_pnl >= 0 ? COLORS.bullish : COLORS.bearish }}>
                {backtestStats.total_pnl >= 0 ? "+" : ""}{backtestStats.total_pnl.toFixed(2)}
              </span>
                  <span style={styles.btLabel}>Total PnL</span>
                </div>
                <div style={styles.btStat}>
                  <span style={{ ...styles.btValue, color: COLORS.bullish }}>{backtestStats.winners}</span>
                  <span style={styles.btLabel}>Winners</span>
                </div>
                <div style={styles.btStat}>
                  <span style={{ ...styles.btValue, color: COLORS.bearish }}>{backtestStats.losers}</span>
                  <span style={styles.btLabel}>Losers</span>
                </div>
                <div style={styles.btStat}>
                  <span style={{ ...styles.btValue, color: COLORS.bullish }}>+{backtestStats.avg_win.toFixed(3)}</span>
                  <span style={styles.btLabel}>Avg Win</span>
                </div>
                <div style={styles.btStat}>
                  <span style={{ ...styles.btValue, color: COLORS.bearish }}>{backtestStats.avg_loss.toFixed(3)}</span>
                  <span style={styles.btLabel}>Avg Loss</span>
                </div>
                <div style={styles.btStat}>
                  <span style={{ ...styles.btValue, color: COLORS.accent }}>1:{backtestStats.risk_reward}</span>
                  <span style={styles.btLabel}>R:R</span>
                </div>
              </div>
            </div>
        )}

        {stats && (
            <div style={styles.statsBar}>
              <div style={styles.statItem}>
                <span style={styles.statValue}>{stats.candles.toLocaleString()}</span>
                <span style={styles.statLabel}>Candles</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={styles.statValue}>{stats.swings}</span>
                <span style={styles.statLabel}>Swings</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={{ ...styles.statValue, color: COLORS.bullish }}>{stats.bullishOB}</span>
                <span style={styles.statLabel}>Bull OB</span>
              </div>
              <div style={styles.statItem}>
                <span style={{ ...styles.statValue, color: COLORS.bearish }}>{stats.bearishOB}</span>
                <span style={styles.statLabel}>Bear OB</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={{ ...styles.statValue, color: COLORS.fvg }}>{stats.fvgs}</span>
                <span style={styles.statLabel}>FVGs</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.statItem}>
                <span style={{ ...styles.statValue, color: COLORS.liquidity }}>{stats.liquidity}</span>
                <span style={styles.statLabel}>Liq Levels</span>
              </div>
            </div>
        )}
      </div>
  );
}

const styles = {
  root: { minHeight: "100vh", background: COLORS.bg, fontFamily: "'Outfit', sans-serif", color: COLORS.text, padding: "0" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: `1px solid ${COLORS.border}` },
  headerLeft: { display: "flex", alignItems: "center", gap: "16px" },
  headerRight: { display: "flex", alignItems: "center", gap: "12px" },
  logo: { display: "flex", alignItems: "center", gap: "12px" },
  logoIcon: { width: "36px", height: "36px", borderRadius: "8px", background: `linear-gradient(135deg, ${COLORS.accent}, #818cf8)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono', monospace", fontWeight: "700", fontSize: "13px", color: "#fff", letterSpacing: "-0.5px" },
  logoTitle: { fontSize: "16px", fontWeight: "600", color: COLORS.textBright, letterSpacing: "-0.3px" },
  logoSub: { fontSize: "11px", color: COLORS.textDim, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.5px", textTransform: "uppercase" },
  pairBadge: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", background: COLORS.surfaceLight, borderRadius: "6px", border: `1px solid ${COLORS.border}` },
  pairFlag: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: "600", fontSize: "13px", color: COLORS.textBright },
  pairLabel: { fontSize: "10px", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "1px" },
  loadingDot: { width: "8px", height: "8px", borderRadius: "50%", background: COLORS.accent, animation: "pulse 1.5s infinite" },
  controls: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: `1px solid ${COLORS.border}`, flexWrap: "wrap", gap: "12px" },
  controlGroup: { display: "flex", alignItems: "center", gap: "10px" },
  controlLabel: { fontSize: "10px", fontWeight: "500", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: "'IBM Plex Mono', monospace" },
  tfGroup: { display: "flex", gap: "2px", background: COLORS.surface, borderRadius: "6px", padding: "2px", border: `1px solid ${COLORS.border}` },
  tfBtn: { padding: "6px 12px", fontSize: "12px", fontWeight: "500", fontFamily: "'IBM Plex Mono', monospace", color: COLORS.textDim, background: "transparent", border: "none", borderRadius: "4px", cursor: "pointer", transition: "all 0.15s ease" },
  tfBtnActive: { background: COLORS.accent, color: "#fff", boxShadow: `0 0 12px ${COLORS.accentDim}` },
  indicatorGroup: { display: "flex", gap: "6px", flexWrap: "wrap" },
  indBtn: { display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", fontSize: "11px", fontWeight: "500", fontFamily: "'Outfit', sans-serif", color: COLORS.textDim, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "6px", cursor: "pointer", transition: "all 0.15s ease" },
  indDot: { width: "6px", height: "6px", borderRadius: "50%" },
  chartWrapper: { padding: "12px 24px" },
  chart: { borderRadius: "8px", overflow: "hidden", border: `1px solid ${COLORS.border}` },
  sectionLabel: { fontSize: "10px", fontWeight: "500", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: "'IBM Plex Mono', monospace", marginBottom: "8px" },
  backtestBar: { margin: "0 24px 16px", padding: "16px 20px", background: COLORS.surface, borderRadius: "8px", border: `1px solid ${COLORS.border}` },
  backtestTitle: { fontSize: "11px", fontWeight: "600", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: "'IBM Plex Mono', monospace", marginBottom: "12px" },
  backtestGrid: { display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "12px" },
  btStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" },
  btValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "16px", fontWeight: "600", color: COLORS.textBright },
  btLabel: { fontSize: "9px", fontWeight: "500", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.8px" },
  statsBar: { display: "flex", alignItems: "center", gap: "20px", padding: "14px 24px", margin: "0 24px 24px", background: COLORS.surface, borderRadius: "8px", border: `1px solid ${COLORS.border}`, flexWrap: "wrap" },
  statItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" },
  statValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "15px", fontWeight: "600", color: COLORS.textBright },
  statLabel: { fontSize: "9px", fontWeight: "500", color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "1px" },
  statDivider: { width: "1px", height: "28px", background: COLORS.border },
};

export default App;