import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const TIMEFRAMES = [1, 3, 5, 15, 30, 60];
const OBJECTIVES = [
  { key: 'net_pnl', label: 'Net PnL' },
  { key: 'sharpe_ratio', label: 'Sharpe' },
  { key: 'sortino_ratio', label: 'Sortino' },
  { key: 'profit_factor', label: 'Profit Factor' },
  { key: 'calmar_ratio', label: 'Calmar' },
  { key: 'recovery_ratio', label: 'Recovery' },
  { key: 'win_rate', label: 'Win Rate %' },
  { key: 'max_drawdown_pct', label: 'Max DD %' },
  { key: 'trade_count', label: 'Trades' },
  { key: 'pf_x_wr', label: 'PF x WR' },
  { key: 'custom_fitness', label: 'Fitness' },
];

function NumberInput({ label, value, onChange, min = 0, step = 1 }) {
  return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">{label}</label>
        <input
            type="number"
            min={min}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
        />
      </div>
  );
}

function TextListInput({ label, value, onChange, placeholder }) {
  return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">{label}</label>
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
        />
      </div>
  );
}

function parseCsvTokens(value) {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function parseIntList(value, fallback) {
  const parsed = parseCsvTokens(value)
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isInteger(v));
  return parsed.length ? parsed : fallback;
}

function parseFloatList(value, fallback) {
  const parsed = parseCsvTokens(value)
      .map((v) => Number.parseFloat(v))
      .filter((v) => Number.isFinite(v));
  return parsed.length ? parsed : fallback;
}

function parseBoolList(value, fallback) {
  const parsed = parseCsvTokens(value)
      .map((v) => v.toLowerCase())
      .filter((v) => ['true', 'false', '1', '0', 'yes', 'no', 'y', 'n'].includes(v))
      .map((v) => ['true', '1', 'yes', 'y'].includes(v));
  return parsed.length ? parsed : fallback;
}

export function OptimizerTab({ datasets = [], selectedDataset, onDatasetChange, onActivateResult }) {
  const [abortController, setAbortController] = useState(null);
  const [timeframe, setTimeframe] = useState(5);
  const [riskRewards, setRiskRewards] = useState('1,1.5,2.0,2.5,3.0');
  const [minTrades, setMinTrades] = useState(5);
  const [maxTrades, setMaxTrades] = useState(1000);
  const [maxCombinations, setMaxCombinations] = useState(1000);
  const [comboSamplingMode, setComboSamplingMode] = useState('random');
  const [comboSamplingSeed, setComboSamplingSeed] = useState('');
  const [topN, setTopN] = useState(10);

  const [sessions, setSessions] = useState('london,new_york');
  const [lookbacks, setLookbacks] = useState('3,5,7,10');
  const [obAges, setObAges] = useState('20,50,80');
  const [atrValues, setAtrValues] = useState('1.0,1.5,2.0,2.5');
  const [minObSizeValues, setMinObSizeValues] = useState('0.00030,0.00040,0.00050,0.00060,0.00080');
  const [minGapSizeValues, setMinGapSizeValues] = useState('0.00015,0.00020,0.00025,0.00030,0.00035');
  const [impulseMultiplierValues, setImpulseMultiplierValues] = useState('1.15,1.25,1.35,1.45,1.60');
  const [requireUnmitigatedFvgModes, setRequireUnmitigatedFvgModes] = useState('true,false');
  const [requireFvgObConfluenceModes, setRequireFvgObConfluenceModes] = useState('true,false');
  const [requireBosConfluenceModes, setRequireBosConfluenceModes] = useState('true,false');
  const [sweepModes, setSweepModes] = useState('true,false');
  const [sweepLookbacks, setSweepLookbacks] = useState('5,10,15');
  const [asianSweepOnlyModes, setAsianSweepOnlyModes] = useState('true,false');
  const [useBreakEvenModes, setUseBreakEvenModes] = useState('false,true');
  const [beTriggerRrValues, setBeTriggerRrValues] = useState('1.0,1.5,2.0');

  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);
  const [xAxisMetric, setXAxisMetric] = useState('max_drawdown_pct');
  const [yAxisMetric, setYAxisMetric] = useState('net_pnl');
  const [rankObjective, setRankObjective] = useState('custom_fitness');
  const [mcRuns, setMcRuns] = useState(500);
  const [mcVariationPct, setMcVariationPct] = useState(15);
  const [mcPriceNoisePct, setMcPriceNoisePct] = useState(0);
  const [mcSlippage, setMcSlippage] = useState(0);
  const [mcSpread, setMcSpread] = useState(0);
  const [mcRuinDrawdownPct, setMcRuinDrawdownPct] = useState(20);
  const [mcShuffleTrades, setMcShuffleTrades] = useState(true);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcErrorMessage, setMcErrorMessage] = useState('');
  const [mcResult, setMcResult] = useState(null);
  const [topSortKey, setTopSortKey] = useState('net_pnl');
  const [topSortDir, setTopSortDir] = useState('desc');
  const [selectedTopRowId, setSelectedTopRowId] = useState(null);
  const [showPresets, setShowPresets] = useState(false);
  const [presetSaveName, setPresetSaveName] = useState('');
  const [presetSaveRow, setPresetSaveRow] = useState(null);

  const PRESETS_KEY = 'nq_backtest_presets';

  const loadPresets = () => {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); }
    catch { return {}; }
  };

  const [presets, setPresets] = useState(loadPresets);

  const mapOptimizerParamsToPreset = (params, tf, rr) => ({
    timeframe: tf ?? timeframe,
    riskReward: Number(params.rr ?? rr ?? 2.5),
    session: params.session ?? 'london',
    lookback: Number(params.lookback ?? 7),
    atrMult: Number(params.atr_mult ?? 2.5),
    obMaxAge: Number(params.ob_age ?? 50),
    useFvg: true,
    useOb: true,
    useLiquiditySweep: params.sweep !== false && params.sweep !== 'false',
    sweepLookback: Number(params.sweep_lookback ?? 5),
    proximityPct: Number(params.proximity_pct ?? 0.5),
    minGapSize: Number(params.min_gap_size ?? 0),
    impulseMultiplier: Number(params.impulse_multiplier ?? 0),
    requireUnmitigatedFvg: params.require_unmitigated_fvg !== false && params.require_unmitigated_fvg !== 'false',
    requireBosConfluence: params.require_bos_confluence === true || params.require_bos_confluence === 'true',
    minObSize: Number(params.min_ob_size ?? 0),
    requireFvgObConfluence: params.require_fvg_ob_confluence === true || params.require_fvg_ob_confluence === 'true',
    asianSweepOnly: params.asian_sweep_only === true || params.asian_sweep_only === 'true',
    useBreakEven: params.use_break_even === true || params.use_break_even === 'true',
    beTriggerRr: Number(params.be_trigger_rr ?? 1.0),
    dayFilter: [0, 1, 2, 3, 4],
    maxDailyLoss: 0,
    maxConsecutiveLosses: 0,
  });

  const saveResultAsPreset = (name, row) => {
    if (!name.trim() || !row?.params) return;
    const preset = mapOptimizerParamsToPreset(row.params, timeframe, row.params.rr);
    const updated = { ...loadPresets(), [name.trim()]: preset };
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    setPresets(updated);
    setPresetSaveName('');
    setPresetSaveRow(null);
  };

  const deletePreset = (name) => {
    const updated = { ...loadPresets() };
    delete updated[name];
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    setPresets(updated);
  };

  const best = result?.best_result ?? null;
  const allResults = result?.all_results ?? [];
  const topResults = useMemo(() => result?.top_results ?? [], [result]);
  const paretoFront = result?.pareto_front ?? [];

  const makeTopRowId = useCallback((row) => {
    const paramsKey = JSON.stringify(row?.params ?? {});
    return `${paramsKey}|${row?.net_pnl ?? row?.pnl ?? 0}|${row?.trade_count ?? row?.trades ?? 0}`;
  }, []);

  const sortedTopResults = useMemo(() => {
    const rows = [...topResults];
    rows.sort((a, b) => {
      const aVal = Number(a?.[topSortKey] ?? (topSortKey === 'trade_count' ? a?.trades : 0));
      const bVal = Number(b?.[topSortKey] ?? (topSortKey === 'trade_count' ? b?.trades : 0));
      if (aVal === bVal) return 0;
      return topSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return rows;
  }, [topResults, topSortDir, topSortKey]);

  const selectedTopResult = useMemo(() => {
    if (!sortedTopResults.length) return null;
    if (!selectedTopRowId) return sortedTopResults[0];
    return sortedTopResults.find((row) => makeTopRowId(row) === selectedTopRowId) ?? sortedTopResults[0];
  }, [sortedTopResults, selectedTopRowId, makeTopRowId]);

  const activateTopResult = useCallback((row) => {
    if (!row?.params || !onActivateResult) return;
    const selectedRr = Number(row.params.rr ?? parseFloatList(riskRewards, [2.5])[0] ?? 2.5);
    onActivateResult({
      params: row.params,
      timeframe,
      riskReward: selectedRr,
      dataset: selectedDataset,
    });
  }, [onActivateResult, timeframe, riskRewards, selectedDataset]);

  const handleChartPointSelect = useCallback((point) => {
    const row = point?.payload ?? point;
    if (!row?.params) return;

    setSelectedTopRowId(makeTopRowId(row));
    activateTopResult(row);
  }, [activateTopResult, makeTopRowId]);

  const estimatedCombos = useMemo(() => {
    const count = (value) => value.split(',').map((v) => v.trim()).filter(Boolean).length;
    const boolCount = count(sweepModes);
    const sweepLbCount = count(sweepLookbacks);
    const hasFalse = sweepModes.toLowerCase().split(',').some((v) => ['false', '0', 'no', 'n'].includes(v.trim()));
    const hasTrue = sweepModes.toLowerCase().split(',').some((v) => ['true', '1', 'yes', 'y'].includes(v.trim()));
    const sweepFactor = (hasTrue ? sweepLbCount : 0) + (hasFalse ? 1 : 0);
    return count(sessions)
        * count(riskRewards)
        * count(lookbacks)
        * count(obAges)
        * count(atrValues)
        * count(minObSizeValues)
        * count(minGapSizeValues)
        * count(impulseMultiplierValues)
        * count(requireUnmitigatedFvgModes)
        * count(requireFvgObConfluenceModes)
        * count(requireBosConfluenceModes)
        * count(asianSweepOnlyModes)
        * count(useBreakEvenModes)
        * count(beTriggerRrValues)
        * Math.max(1, sweepFactor || boolCount);
  }, [
    sessions,
    riskRewards,
    lookbacks,
    obAges,
    atrValues,
    minObSizeValues,
    minGapSizeValues,
    impulseMultiplierValues,
    requireUnmitigatedFvgModes,
    requireFvgObConfluenceModes,
    requireBosConfluenceModes,
    sweepModes,
    sweepLookbacks,
    asianSweepOnlyModes,
    useBreakEvenModes,
    beTriggerRrValues,
  ]);

  const mcPnlHistogram = useMemo(() => {
    const values = (mcResult?.distribution || [])
        .map((row) => Number(row?.net_pnl))
        .filter((value) => Number.isFinite(value));

    if (!values.length) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return [{ pnlLabel: min.toFixed(2), runCount: values.length }];
    }

    const binCount = Math.min(16, Math.max(8, Math.round(Math.sqrt(values.length))));
    const binSize = (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => {
      const start = min + (index * binSize);
      const end = index === binCount - 1 ? max : start + binSize;
      return {
        start,
        end,
        runCount: 0,
        pnlLabel: `${start.toFixed(1)} to ${end.toFixed(1)}`,
      };
    });

    for (const value of values) {
      const rawIndex = Math.floor((value - min) / binSize);
      const index = Math.min(binCount - 1, Math.max(0, rawIndex));
      bins[index].runCount += 1;
    }

    return bins;
  }, [mcResult]);

  const mcRuinRateFromDistribution = useMemo(() => {
    const distribution = mcResult?.distribution || [];
    if (!distribution.length) return 0;
    const ruined = distribution.filter((row) => row?.ruin).length;
    return (ruined / distribution.length) * 100;
  }, [mcResult]);

  const runOptimization = useCallback(async () => {
    if (!selectedDataset) return;
    abortController?.abort();
    const controller = new AbortController();
    setAbortController(controller);

    setLoading(true);
    setErrorMessage('');
    setResult(null);
    setMcResult(null);
    setMcErrorMessage('');
    setSelectedTopRowId(null);
    setProgressPct(1);

    try {
      const payload = {
        timeframe: Number(timeframe),
        rr_values: parseFloatList(riskRewards, [1, 1.5, 2.0, 2.5, 3.0]),
        dataset: selectedDataset,
        min_trades: Number(minTrades),
        max_trades: Number(maxTrades),
        max_combinations: Number(maxCombinations),
        combo_sampling_mode: comboSamplingMode,
        top_n: Number(topN),
        rank_objective: rankObjective,
        sessions: parseCsvTokens(sessions).length ? parseCsvTokens(sessions) : ['london', 'new_york'],
        lookback_values: parseIntList(lookbacks, [3, 5, 7, 10]),
        ob_age_values: parseIntList(obAges, [20, 50, 80]),
        atr_values: parseFloatList(atrValues, [1.0, 1.5, 2.0, 2.5]),
        min_ob_size_values: parseFloatList(minObSizeValues, [0.00030, 0.00040, 0.00050, 0.00060, 0.00080]),
        min_gap_size_values: parseFloatList(minGapSizeValues, [0.00015, 0.00020, 0.00025, 0.00030, 0.00035]),
        impulse_multiplier_values: parseFloatList(impulseMultiplierValues, [1.15, 1.25, 1.35, 1.45, 1.60]),
        require_unmitigated_fvg_modes: parseBoolList(requireUnmitigatedFvgModes, [true, false]),
        require_fvg_ob_confluence_modes: parseBoolList(requireFvgObConfluenceModes, [true, false]),
        require_bos_confluence_modes: parseBoolList(requireBosConfluenceModes, [true, false]),
        sweep_modes: parseBoolList(sweepModes, [true, false]),
        sweep_lb_values: parseIntList(sweepLookbacks, [5, 10, 15]),
        asian_sweep_only_modes: parseBoolList(asianSweepOnlyModes, [true, false]),
        use_break_even_modes: parseBoolList(useBreakEvenModes, [false, true]),
        be_trigger_rr_values: parseFloatList(beTriggerRrValues, [1.0, 1.5, 2.0]),
      };
      const seedValue = comboSamplingSeed.trim();
      if (seedValue) {
        payload.combo_sampling_seed = Number.parseInt(seedValue, 10);
      }

      const response = await fetch(`${API_BASE_URL}/api/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        let detail = 'Optimization failed';
        try {
          const data = await response.json();
          detail = data?.detail ?? detail;
        } catch {
          // ignore parse failure and keep fallback message
        }
        throw new Error(detail);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyEventChunk = (eventChunk) => {
        const dataLines = eventChunk
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'));
        if (!dataLines.length) return;

        for (const line of dataLines) {
          const jsonPayload = line.replace(/^data:\s*/, '');
          const data = JSON.parse(jsonPayload);

          if (data.type === 'progress') {
            setProgressPct(data.progress ?? 0);
            setResult((prev) => ({
              ...(prev || {}),
              total_combinations: data.total_combinations,
              generated_combinations: data.generated_combinations ?? prev?.generated_combinations,
              executed_combinations: data.executed_combinations ?? data.total_combinations,
              max_combinations: data.max_combinations ?? prev?.max_combinations,
              capped_by_max_combinations: data.capped_by_max_combinations ?? prev?.capped_by_max_combinations ?? false,
              combo_sampling_mode: data.combo_sampling_mode ?? prev?.combo_sampling_mode,
              combo_sampling_seed: data.combo_sampling_seed ?? prev?.combo_sampling_seed,
              valid_results: data.valid_results,
              rank_objective: data.rank_objective ?? rankObjective,
              top_results: data.top_results || [],
              pareto_front: data.pareto_front || prev?.pareto_front || [],
            }));
          } else if (data.type === 'finished') {
            setResult(data);
            setProgressPct(100);
            setLoading(false);
            if (data?.best_result?.params) {
              activateTopResult(data.best_result);
            }
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventChunk of events) {
          applyEventChunk(eventChunk);
        }
      }

      if (buffer.trim()) {
        applyEventChunk(buffer);
      }

    } catch (err) {
      if (err?.name === 'AbortError') {
        setErrorMessage('Optimization aborted by user.');
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  }, [
    abortController,
    selectedDataset,
    timeframe,
    riskRewards,
    minTrades,
    maxTrades,
    maxCombinations,
    comboSamplingMode,
    comboSamplingSeed,
    topN,
    rankObjective,
    sessions,
    lookbacks,
    obAges,
    atrValues,
    minObSizeValues,
    minGapSizeValues,
    impulseMultiplierValues,
    requireUnmitigatedFvgModes,
    requireFvgObConfluenceModes,
    requireBosConfluenceModes,
    sweepModes,
    sweepLookbacks,
    asianSweepOnlyModes,
    useBreakEvenModes,
    beTriggerRrValues,
    activateTopResult,
  ]);

  const abortOptimization = useCallback(() => {
    abortController?.abort();
  }, [abortController]);

  const runMonteCarlo = useCallback(async () => {
    const targetParams = selectedTopResult?.params ?? best?.params;
    if (!targetParams || !selectedDataset) {
      setMcErrorMessage('Run optimization first so Monte Carlo can use the best parameter set.');
      return;
    }

    setMcLoading(true);
    setMcErrorMessage('');
    setMcResult(null);

    try {
      const selectedRr = Number(targetParams.rr ?? parseFloatList(riskRewards, [2.5])[0] ?? 2.5);
      const params = new URLSearchParams({
        timeframe: String(timeframe),
        rr: String(selectedRr),
        dataset: selectedDataset,
        session: String(targetParams.session ?? 'london'),
        lookback: String(targetParams.lookback ?? 7),
        ob_age: String(targetParams.ob_age ?? 50),
        atr_mult: String(targetParams.atr_mult ?? 2.5),
        min_ob_size: String(targetParams.min_ob_size ?? 0.0005),
        min_gap_size: String(targetParams.min_gap_size ?? 0.00025),
        impulse_multiplier: String(targetParams.impulse_multiplier ?? 1.35),
        require_unmitigated_fvg: String(targetParams.require_unmitigated_fvg ?? true),
        require_fvg_ob_confluence: String(targetParams.require_fvg_ob_confluence ?? false),
        require_bos_confluence: String(targetParams.require_bos_confluence ?? false),
        sweep: String(targetParams.sweep ?? true),
        sweep_lookback: String(targetParams.sweep_lookback ?? 5),
        asian_sweep_only: String(targetParams.asian_sweep_only ?? false),
        use_break_even: String(targetParams.use_break_even ?? false),
        be_trigger_rr: String(targetParams.be_trigger_rr ?? 1.0),
        runs: String(mcRuns),
        shuffle_trades: String(mcShuffleTrades),
        pnl_variation_pct: String(mcVariationPct),
        price_noise_pct: String(mcPriceNoisePct),
        slippage_per_trade: String(mcSlippage),
        spread_per_trade: String(mcSpread),
        ruin_drawdown_pct: String(mcRuinDrawdownPct),
      });

      const response = await fetch(`${API_BASE_URL}/api/optimize/monte-carlo?${params.toString()}`);
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
    best,
    selectedTopResult,
    selectedDataset,
    timeframe,
    riskRewards,
    mcRuns,
    mcVariationPct,
    mcPriceNoisePct,
    mcSlippage,
    mcSpread,
    mcRuinDrawdownPct,
    mcShuffleTrades,
  ]);

  useEffect(() => {
    if (!sortedTopResults.length) {
      setSelectedTopRowId(null);
      return;
    }
    if (!selectedTopRowId) {
      setSelectedTopRowId(makeTopRowId(sortedTopResults[0]));
      return;
    }
    const stillExists = sortedTopResults.some((row) => makeTopRowId(row) === selectedTopRowId);
    if (!stillExists) {
      setSelectedTopRowId(makeTopRowId(sortedTopResults[0]));
    }
  }, [sortedTopResults, selectedTopRowId, makeTopRowId]);

  useEffect(() => () => {
    abortController?.abort();
  }, [abortController]);


  return (
      <div className="space-y-6">
        <section className="border border-[#262626] bg-[#0a0a0a] p-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest mb-1">Optimizer</p>
              <h2 className="text-[20px] font-semibold tracking-tight">Parameter sweep simulations</h2>
            </div>
            <div className="flex items-center gap-3">
              {loading && (
                  <button
                      onClick={abortOptimization}
                      className="px-4 py-2 text-[13px] font-semibold font-mono border border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444] hover:text-black transition-colors"
                  >
                    Abort
                  </button>
              )}
              <button
                  onClick={() => setShowPresets((p) => !p)}
                  className="px-4 py-2 text-[13px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors"
              >
                Presets
              </button>
              <button
                  onClick={runMonteCarlo}
                  disabled={loading || mcLoading || !best}
                  className="px-5 py-2 text-[13px] font-semibold font-mono bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-colors disabled:opacity-40"
              >
                {mcLoading ? 'Running Monte Carlo...' : 'Monte Carlo (Selected)'}
              </button>
              <button
                  onClick={() => activateTopResult(selectedTopResult)}
                  disabled={loading || !selectedTopResult}
                  className="px-5 py-2 text-[13px] font-semibold font-mono border border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-black transition-colors disabled:opacity-40"
              >
                Activate Selected
              </button>
              <button
                  onClick={runOptimization}
                  disabled={loading}
                  className="px-5 py-2 text-[13px] font-semibold font-mono bg-[#fafafa] text-black hover:bg-[#e5e5e5] transition-colors disabled:opacity-40"
              >
                {loading ? 'Optimizing...' : 'Run Optimization'}
              </button>
            </div>
          </div>

          {showPresets && (
              <div className="mb-6 p-5 border border-[#262626] bg-black">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[14px] font-semibold tracking-tight">Saved Presets</h3>
                  <button onClick={() => setShowPresets(false)} className="text-[#525252] hover:text-[#fafafa] text-[18px] leading-none transition-colors">x</button>
                </div>
                {Object.keys(presets).length === 0 ? (
                    <p className="text-[13px] text-[#525252] font-mono">No saved presets. Save a top result to create one.</p>
                ) : (
                    <div className="space-y-2">
                      {Object.keys(presets).map((name) => (
                          <div key={name} className="flex items-center justify-between p-3 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
                            <span className="text-[13px] font-mono text-[#fafafa]">{name}</span>
                            <div className="flex gap-2">
                              <button
                                  onClick={() => {
                                    const p = presets[name];
                                    if (onActivateResult && p) {
                                      onActivateResult({
                                        params: {
                                          session: p.session,
                                          lookback: p.lookback,
                                          ob_age: p.obMaxAge,
                                          atr_mult: p.atrMult,
                                          min_ob_size: p.minObSize,
                                          min_gap_size: p.minGapSize,
                                          impulse_multiplier: p.impulseMultiplier,
                                          require_unmitigated_fvg: p.requireUnmitigatedFvg,
                                          require_fvg_ob_confluence: p.requireFvgObConfluence,
                                          require_bos_confluence: p.requireBosConfluence,
                                          sweep: p.useLiquiditySweep,
                                          sweep_lookback: p.sweepLookback,
                                          asian_sweep_only: p.asianSweepOnly,
                                          use_break_even: p.useBreakEven,
                                          be_trigger_rr: p.beTriggerRr,
                                        },
                                        timeframe: p.timeframe,
                                        riskReward: p.riskReward,
                                        dataset: selectedDataset,
                                      });
                                    }
                                    setShowPresets(false);
                                  }}
                                  className="px-3 py-1 text-[12px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors"
                              >
                                Load
                              </button>
                              <button
                                  onClick={() => deletePreset(name)}
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

          <div className="mb-6">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#737373] mb-1">
              <span>{loading ? 'Running simulations...' : 'Progress'}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2 border border-[#1f1f1f] bg-black/50 overflow-hidden">
              <div
                  className={`h-full transition-all duration-150 ${loading ? 'bg-[#10b981]' : 'bg-[#404040]'}`}
                  style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

              {errorMessage && (
                  <div className="mb-6 border border-[#7f1d1d] bg-[#1b0a0a] text-[#fca5a5] px-4 py-3 text-[12px] font-mono">
                    {errorMessage}
                  </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-4 mb-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Timeframe</label>
                  <select
                      className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040]"
                      value={timeframe}
                      onChange={(e) => setTimeframe(Number(e.target.value))}
                  >
                    {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}m</option>)}
                  </select>
                </div>

                <TextListInput label="Risk Rewards" value={riskRewards} onChange={setRiskRewards} placeholder="1,1.5,2.0,2.5,3.0" />
                <NumberInput label="Min Trades" value={minTrades} onChange={setMinTrades} min={1} />
                <NumberInput label="Max Trades" value={maxTrades} onChange={setMaxTrades} min={1} />
                <NumberInput label="Max Combos" value={maxCombinations} onChange={setMaxCombinations} min={1} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Sampling</label>
                  <select
                      className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040]"
                      value={comboSamplingMode}
                      onChange={(e) => setComboSamplingMode(e.target.value)}
                  >
                    <option value="random">Random (Reservoir)</option>
                    <option value="first">First N</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Sampling Seed</label>
                  <input
                      type="number"
                      value={comboSamplingSeed}
                      onChange={(e) => setComboSamplingSeed(e.target.value)}
                      placeholder="optional"
                      className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
                  />
                </div>
                <NumberInput label="Top Results" value={topN} onChange={setTopN} min={1} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Rank By</label>
                  <select
                      className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040]"
                      value={rankObjective}
                      onChange={(e) => setRankObjective(e.target.value)}
                  >
                    {OBJECTIVES.map((objective) => (
                        <option key={objective.key} value={objective.key}>{objective.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 col-span-2 lg:col-span-1">
                  <label className="text-[11px] text-[#525252] font-mono uppercase tracking-widest">Dataset</label>
                  <select
                      className="w-full border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040]"
                      value={selectedDataset}
                      onChange={(e) => onDatasetChange(e.target.value)}
                  >
                    {datasets.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <TextListInput label="Sessions" value={sessions} onChange={setSessions} placeholder="london,new_york" />
                <TextListInput label="Lookbacks" value={lookbacks} onChange={setLookbacks} placeholder="3,5,7,10" />
                <TextListInput label="OB Ages" value={obAges} onChange={setObAges} placeholder="20,50,80" />
                <TextListInput label="ATR Values" value={atrValues} onChange={setAtrValues} placeholder="1.0,1.5,2.0,2.5" />
                <TextListInput label="Min OB Size (pips)" value={minObSizeValues} onChange={setMinObSizeValues} placeholder="0.00030,0.00040,0.00050,0.00060,0.00080" />
                <TextListInput label="Min Gap Size (pips)" value={minGapSizeValues} onChange={setMinGapSizeValues} placeholder="0.00015,0.00020,0.00025,0.00030,0.00035" />
                <TextListInput label="Impulse Multiplier" value={impulseMultiplierValues} onChange={setImpulseMultiplierValues} placeholder="1.15,1.25,1.35,1.45,1.60" />
                <TextListInput label="Require Unmitigated FVG" value={requireUnmitigatedFvgModes} onChange={setRequireUnmitigatedFvgModes} placeholder="true,false" />
                <TextListInput label="Require FVG + OB" value={requireFvgObConfluenceModes} onChange={setRequireFvgObConfluenceModes} placeholder="true,false" />
                <TextListInput label="Require BOS/MSS" value={requireBosConfluenceModes} onChange={setRequireBosConfluenceModes} placeholder="true,false" />
                <TextListInput label="Sweep Modes" value={sweepModes} onChange={setSweepModes} placeholder="true,false" />
                <TextListInput label="Sweep Lookbacks" value={sweepLookbacks} onChange={setSweepLookbacks} placeholder="5,10,15" />
                <TextListInput label="Asian Sweep Only" value={asianSweepOnlyModes} onChange={setAsianSweepOnlyModes} placeholder="true,false" />
                <TextListInput label="Use Break-Even" value={useBreakEvenModes} onChange={setUseBreakEvenModes} placeholder="false,true" />
                <TextListInput label="BE Trigger RR" value={beTriggerRrValues} onChange={setBeTriggerRrValues} placeholder="1.0,1.5,2.0" />
              </div>

              <div className="mt-6 border border-[#1a1a1a] bg-black/40 p-4">
                <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest mb-4">Monte Carlo Settings</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <NumberInput label="Runs" value={mcRuns} onChange={setMcRuns} min={1} step={1} />
                  <NumberInput label="Pnl Var %" value={mcVariationPct} onChange={setMcVariationPct} min={0} step={1} />
                  <NumberInput label="Price Noise %" value={mcPriceNoisePct} onChange={setMcPriceNoisePct} min={0} step={1} />
                  <NumberInput label="Slippage" value={mcSlippage} onChange={setMcSlippage} min={0} step={0.01} />
                  <NumberInput label="Spread" value={mcSpread} onChange={setMcSpread} min={0} step={0.01} />
                  <NumberInput label="Ruin DD %" value={mcRuinDrawdownPct} onChange={setMcRuinDrawdownPct} min={0} step={1} />
                </div>
                <label className="mt-4 inline-flex items-center gap-2 text-[12px] font-mono text-[#a3a3a3]">
                  <input
                      type="checkbox"
                      checked={mcShuffleTrades}
                      onChange={(e) => setMcShuffleTrades(e.target.checked)}
                      className="h-4 w-4"
                  />
                  Shuffle trade order each simulation run
                </label>
              </div>

              <div className="mt-5 text-[12px] text-[#737373] font-mono">
                Estimated combinations: <span className="text-[#fafafa]">{estimatedCombos}</span>
                {' '}
                <span className="text-[#a3a3a3]">(executed max: {maxCombinations})</span>
              </div>

              {mcErrorMessage && (
                  <div className="mt-4 border border-[#7f1d1d] bg-[#1b0a0a] text-[#fca5a5] px-4 py-3 text-[12px] font-mono">
                    {mcErrorMessage}
                  </div>
              )}
        </section>

        {result && (
            <section className="border border-[#262626] bg-[#0a0a0a] p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Combos</p>
                  <p className="text-[22px] font-semibold">{result.executed_combinations ?? result.total_combinations}</p>
                  <p className="text-[11px] text-[#737373] font-mono mt-1">
                    generated: {result.generated_combinations ?? result.total_combinations}
                  </p>
                  {(result.capped_by_max_combinations || false) && (
                      <p className="text-[11px] text-[#f59e0b] font-mono mt-1">
                        capped at {result.max_combinations}
                      </p>
                  )}
                  <p className="text-[11px] text-[#737373] font-mono mt-1">
                    sampling: {result.combo_sampling_mode ?? comboSamplingMode}
                    {result.combo_sampling_seed !== null && result.combo_sampling_seed !== undefined ? ` (seed ${result.combo_sampling_seed})` : ''}
                  </p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Valid</p>
                  <p className="text-[22px] font-semibold">{result.valid_results}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Elapsed</p>
                  <p className="text-[22px] font-semibold">{result.elapsed_seconds}s</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                  <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Speed</p>
                  <p className="text-[22px] font-semibold">{result.combos_per_second}/s</p>
                </div>
              </div>

              {best && (
                  <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[11px] text-[#525252] font-mono uppercase tracking-widest mb-2">Best Result</p>
                    <p className="text-[20px] font-semibold text-[#10b981]">
                      {(OBJECTIVES.find((o) => o.key === (result?.rank_objective ?? rankObjective))?.label ?? 'Fitness')}
                      {' '}
                      {Number(best[result?.rank_objective ?? rankObjective] ?? best.custom_fitness ?? 0).toFixed(3)}
                    </p>
                    <p className="text-[12px] font-mono text-[#a3a3a3] mt-2">Trades: {best.trades} | Win Rate: {best.win_rate}%</p>
                    <p className="text-[12px] font-mono text-[#a3a3a3] mt-1">{JSON.stringify(best.params)}</p>
                  </div>
              )}

              {best && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">PnL</p><p className="text-[16px] font-semibold">{best.net_pnl?.toFixed(2)}</p></div>
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Sharpe</p><p className="text-[16px] font-semibold">{best.sharpe_ratio?.toFixed(2)}</p></div>
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Sortino</p><p className="text-[16px] font-semibold">{best.sortino_ratio?.toFixed(2)}</p></div>
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Profit Factor</p><p className="text-[16px] font-semibold">{best.profit_factor?.toFixed(2)}</p></div>
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Calmar</p><p className="text-[16px] font-semibold">{best.calmar_ratio?.toFixed(2)}</p></div>
                    <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Max DD %</p><p className="text-[16px] font-semibold">{best.max_drawdown_pct?.toFixed(2)}</p></div>
                  </div>
              )}

              <div className="border border-[#1a1a1a] bg-black/40 p-4">
                <div className="flex flex-wrap gap-4 items-center mb-4">
                  <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Pareto Front</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#737373] font-mono uppercase">X</span>
                    <select className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[12px] px-2 py-1" value={xAxisMetric} onChange={(e) => setXAxisMetric(e.target.value)}>
                      {OBJECTIVES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#737373] font-mono uppercase">Y</span>
                    <select className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[12px] px-2 py-1" value={yAxisMetric} onChange={(e) => setYAxisMetric(e.target.value)}>
                      {OBJECTIVES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                      <CartesianGrid stroke="#1f1f1f" />
                      <XAxis type="number" dataKey={xAxisMetric} stroke="#737373" tick={{ fill: '#737373', fontSize: 11 }} />
                      <YAxis type="number" dataKey={yAxisMetric} stroke="#737373" tick={{ fill: '#737373', fontSize: 11 }} />
                      <Tooltip
                          contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #262626', color: '#fafafa' }}
                          labelStyle={{ color: '#fafafa' }}
                          formatter={(value) => Number(value).toFixed(3)}
                      />
                      <Legend />
                      <Scatter
                          name="All Results"
                          data={allResults}
                          fill="#3f3f46"
                          onClick={handleChartPointSelect}
                          style={{ cursor: 'pointer' }}
                      />
                      <Scatter
                          name="Pareto Front"
                          data={paretoFront}
                          fill="#10b981"
                          onClick={handleChartPointSelect}
                          style={{ cursor: 'pointer' }}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border border-[#1a1a1a] bg-black/40 overflow-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                  <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Top Results</p>
                  <div className="flex items-center gap-2">
                    <select
                        className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[11px] px-2 py-1"
                        value={topSortKey}
                        onChange={(e) => setTopSortKey(e.target.value)}
                    >
                      <option value="net_pnl">PnL</option>
                      <option value="win_rate">Win Rate</option>
                      <option value="trade_count">Trades</option>
                      <option value="max_drawdown_pct">Max DD</option>
                      <option value="custom_fitness">Fitness</option>
                    </select>
                    <button
                        onClick={() => setTopSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                        className="border border-[#262626] px-2 py-1 text-[11px] font-mono text-[#fafafa]"
                    >
                      {topSortDir === 'desc' ? 'Desc' : 'Asc'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-[60px_90px_100px_80px_1fr] gap-3 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#737373] border-b border-[#1a1a1a]">
                  <span>#</span>
                  <span>PnL</span>
                  <span>WR</span>
                  <span>Trades</span>
                  <span>Params</span>
                </div>
                {sortedTopResults.map((row, idx) => {
                  const rowId = makeTopRowId(row);
                  const isSelected = rowId === selectedTopRowId;
                  const isSaving = presetSaveRow && makeTopRowId(presetSaveRow) === rowId;
                  return (
                      <div key={`${rowId}-${idx}`}>
                        <button
                            onClick={() => {
                              setSelectedTopRowId(rowId);
                              activateTopResult(row);
                            }}
                            className={`w-full text-left grid grid-cols-[60px_90px_100px_80px_1fr] gap-3 px-4 py-2 text-[12px] font-mono border-b border-[#111111] ${isSelected ? 'bg-[#0f172a]' : 'hover:bg-[#101010]'}`}
                        >
                          <span>{idx + 1}</span>
                          <span className={row.net_pnl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}>{(row.net_pnl ?? row.pnl ?? 0).toFixed(2)}</span>
                          <span>{row.win_rate}%</span>
                          <span>{row.trade_count ?? row.trades}</span>
                          <span className="flex items-center justify-between gap-2">
                    <span className="text-[#a3a3a3] break-all">{JSON.stringify(row.params)}</span>
                    <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPresetSaveRow(isSaving ? null : row);
                          setPresetSaveName('');
                        }}
                        className="shrink-0 px-2 py-0.5 text-[10px] font-mono border border-[#262626] text-[#737373] hover:text-[#10b981] hover:border-[#10b981] transition-colors"
                    >
                      Save
                    </button>
                  </span>
                        </button>
                        {isSaving && (
                            <div className="flex gap-2 px-4 py-2 bg-[#0a0a0a] border-b border-[#1a1a1a]">
                              <input
                                  type="text"
                                  placeholder="Preset name..."
                                  value={presetSaveName}
                                  onChange={(e) => setPresetSaveName(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && saveResultAsPreset(presetSaveName, row)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-1 border border-[#262626] bg-black text-[#fafafa] font-mono text-[12px] px-2 py-1 outline-none focus:border-[#404040]"
                              />
                              <button
                                  onClick={(e) => { e.stopPropagation(); saveResultAsPreset(presetSaveName, row); }}
                                  disabled={!presetSaveName.trim()}
                                  className="px-3 py-1 text-[12px] font-mono bg-[#10b981] text-black hover:bg-[#059669] transition-colors disabled:opacity-30"
                              >
                                Confirm
                              </button>
                            </div>
                        )}
                      </div>
                  )})}
              </div>

              {mcResult && (
                  <div className="border border-[#1a1a1a] bg-black/40 p-4 space-y-4">
                    <p className="text-[11px] text-[#737373] font-mono uppercase tracking-widest">Monte Carlo Output</p>
                    <p className="text-[12px] font-mono text-[#a3a3a3]">
                      Base trades: {mcResult.base?.trade_count} | Base PnL: {Number(mcResult.base?.net_pnl ?? 0).toFixed(2)} | Base WR: {Number(mcResult.base?.win_rate ?? 0).toFixed(2)}%
                    </p>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg PnL</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_pnl ?? 0).toFixed(2)}</p></div>
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Profitable %</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.profitable_run_pct ?? 0).toFixed(2)}%</p></div>
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Worst Max DD %</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.worst_max_drawdown_pct ?? 0).toFixed(2)}</p></div>
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg WR</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_win_rate ?? 0).toFixed(2)}%</p></div>
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Avg PF</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.avg_profit_factor ?? 0).toFixed(2)}</p></div>
                      <div className="p-3 border border-[#1a1a1a] bg-black/40"><p className="text-[10px] text-[#737373] font-mono uppercase">Prob. of Ruin</p><p className="text-[16px] font-semibold">{Number(mcResult.summary?.probability_of_ruin ?? 0).toFixed(2)}%</p></div>
                    </div>

                    {mcPnlHistogram.length > 0 && (
                        <div className="border border-[#1a1a1a] bg-black/40 p-3">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[10px] text-[#737373] font-mono uppercase tracking-widest">PnL Distribution (Monte Carlo)</p>
                            <p className="text-[11px] text-[#a3a3a3] font-mono">
                              Ruin runs: {mcRuinRateFromDistribution.toFixed(2)}%
                            </p>
                          </div>
                          <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={mcPnlHistogram} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke="#1f1f1f" />
                                <XAxis dataKey="pnlLabel" stroke="#737373" tick={{ fill: '#737373', fontSize: 10 }} interval="preserveStartEnd" />
                                <YAxis stroke="#737373" tick={{ fill: '#737373', fontSize: 10 }} allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #262626', color: '#fafafa' }}
                                    formatter={(value) => [value, 'Runs']}
                                    labelFormatter={(label) => `PnL range: ${label}`}
                                />
                                <Bar dataKey="runCount" fill="#6366f1" radius={[2, 2, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                    )}

                    <div className="overflow-auto border border-[#1a1a1a]">
                      <div className="grid grid-cols-[60px_100px_120px_100px_100px_80px] gap-3 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#737373] border-b border-[#1a1a1a]">
                        <span>Run</span>
                        <span>Net PnL</span>
                        <span>Max DD %</span>
                        <span>Win Rate</span>
                        <span>PF</span>
                        <span>Ruin</span>
                      </div>
                      {(mcResult.sample_runs || []).map((run) => (
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
            </section>
        )}
      </div>
  );
}
