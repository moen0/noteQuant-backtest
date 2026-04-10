import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

function App() {
  const chartRef = useRef(null);

  useEffect(() => {
    const chart = createChart(chartRef.current, {
      width: window.innerWidth - 40,
      height: 600,
      layout: {
        background: { color: "#1a1a2e" },
        textColor: "#e0e0e0",
      },
      grid: {
        vertLines: { color: "#2a2a3e" },
        horzLines: { color: "#2a2a3e" },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    fetch("http://localhost:8000/api/candles?timeframe=5")
        .then((res) => res.json())
        .then((data) => {
          const formatted = data.candles.map((c) => ({
            time: Math.floor(new Date(c.time).getTime() / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
          candleSeries.setData(formatted);
        });

    return () => chart.remove();
  }, []);

  return (
      <div style={{ padding: "20px", background: "#1a1a2e", minHeight: "100vh" }}>
        <h1 style={{ color: "#e0e0e0", marginBottom: "10px" }}>noteQuant Backtester</h1>
        <div ref={chartRef} />
      </div>
  );
}

export default App;