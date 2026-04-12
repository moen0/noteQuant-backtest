import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    CartesianGrid,
} from 'recharts';

function formatCurrency(value) {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function CustomTooltip({ active, payload }) {
    if (active && payload && payload.length) {
        const value = payload[0].value;
        return (
            <div className="bg-[#0a0a0a] border border-[#262626] px-4 py-3 shadow-xl">
                <p className="text-[13px] text-[#737373] mb-1">{payload[0].payload.month}</p>
                <p className={`text-[18px] font-semibold ${value >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                    {value >= 0 ? '+' : ''}{value.toFixed(1)}%
                </p>
            </div>
        );
    }
    return null;
}

export function PerformanceBreakdown({ monthlyReturns = [], largestWin = 0, largestLoss = 0, maxDrawdown = 0, sharpeRatio = 0 }) {
    const chartData = monthlyReturns.map((item) => ({
        month: item.month,
        returnPct: item.returnPct,
    }));

    const sorted = [...monthlyReturns];
    const bestMonth = sorted.reduce((best, item) => (item.returnPct > best.returnPct ? item : best), sorted[0] ?? { month: '-', returnPct: 0 });
    const worstMonth = sorted.reduce((worst, item) => (item.returnPct < worst.returnPct ? item : worst), sorted[0] ?? { month: '-', returnPct: 0 });

    return (
        <div className="border border-[#262626] bg-[#0a0a0a] p-8">
            <div className="mb-6">
                <h2 className="text-[20px] font-semibold tracking-tight mb-1">Performance Breakdown</h2>
                <p className="text-[13px] text-[#737373]">Monthly returns</p>
            </div>

            <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                    <XAxis
                        dataKey="month"
                        stroke="#525252"
                        tick={{ fill: '#737373', fontSize: 12 }}
                        axisLine={{ stroke: '#262626' }}
                        tickLine={false}
                    />
                    <YAxis
                        stroke="#525252"
                        tick={{ fill: '#737373', fontSize: 12 }}
                        axisLine={{ stroke: '#262626' }}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a1a1a' }} />
                    <Bar dataKey="returnPct" radius={0}>
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.returnPct >= 0 ? '#10b981' : '#ef4444'} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>

            <div className="mt-8 pt-6 border-t border-[#1a1a1a] grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Max Drawdown</p>
                    <p className="text-[24px] font-semibold text-[#ef4444]">{maxDrawdown.toFixed(1)}%</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Sharpe Ratio</p>
                    <p className={`text-[24px] font-semibold ${sharpeRatio >= 1 ? 'text-[#10b981]' : 'text-[#f59e0b]'}`}>
                        {sharpeRatio.toFixed(2)}
                    </p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Best Month</p>
                    <p className="text-[16px] font-semibold text-[#10b981]">
                        {bestMonth.month} ({bestMonth.returnPct > 0 ? '+' : ''}{bestMonth.returnPct.toFixed(1)}%)
                    </p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Worst Month</p>
                    <p className="text-[16px] font-semibold text-[#ef4444]">
                        {worstMonth.month} ({worstMonth.returnPct > 0 ? '+' : ''}{worstMonth.returnPct.toFixed(1)}%)
                    </p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Largest Win</p>
                    <p className="text-[24px] font-semibold text-[#10b981]">${formatCurrency(largestWin)}</p>
                </div>
                <div className="p-4 border border-[#1a1a1a] bg-black/40">
                    <p className="text-[13px] text-[#737373] mb-2">Largest Loss</p>
                    <p className="text-[24px] font-semibold text-[#ef4444]">${formatCurrency(largestLoss)}</p>
                </div>
            </div>
        </div>
    );
}