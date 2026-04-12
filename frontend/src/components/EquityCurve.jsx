import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0a0a0a] border border-[#262626] px-4 py-3 shadow-xl">
        <p className="text-[13px] text-[#737373] mb-1">{payload[0].payload.date}</p>
        <p className="text-[18px] font-semibold text-[#10b981]">
          ${payload[0].value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </div>
    );
  }
  return null;
}

export function EquityCurve({ data = [], startingBalance = 10000 }) {
  if (!data.length) {
    return (
      <div className="border border-[#262626] bg-[#0a0a0a] p-8">
        <h2 className="text-[20px] font-semibold tracking-tight mb-1">Equity Curve</h2>
        <p className="text-[13px] text-[#737373] mb-6">Account balance progression</p>
        <div className="text-[#525252] text-sm py-12 text-center border border-dashed border-[#262626]">
          No trade data available yet.
        </div>
      </div>
    );
  }

  const lastEquity = data[data.length - 1]?.equity ?? startingBalance;
  const changePct = ((lastEquity - startingBalance) / startingBalance) * 100;

  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight mb-1">Equity Curve</h2>
          <p className="text-[13px] text-[#737373]">Account balance progression</p>
        </div>
        <div className="flex gap-6 text-[13px] text-[#737373] font-mono">
          <span>Start ${startingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <span>End ${lastEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <span className={changePct >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
          <XAxis
            dataKey="date"
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
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#404040', strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="equity"
            stroke="#10b981"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 6, fill: '#10b981', stroke: '#000', strokeWidth: 2 }}
            fill="url(#equityGradient)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
