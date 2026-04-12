import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

function formatCurrency(value) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function CustomTooltip({ active, payload, total }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0a0a0a] border border-[#262626] px-4 py-3 shadow-xl">
        <p className="text-[13px] text-[#fafafa] font-semibold mb-1">{payload[0].name}</p>
        <p className="text-[15px] text-[#737373]">
          {payload[0].value} trades ({((payload[0].value / total) * 100).toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

export function TradeDistribution({ wins = 0, losses = 0, avgWin = 0, avgLoss = 0, largestWin = 0, largestLoss = 0 }) {
  const total = wins + losses;
  const data = [
    { name: 'Wins', value: wins },
    { name: 'Losses', value: losses },
  ];
  const COLORS = ['#10b981', '#ef4444'];

  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-8">
      <div className="mb-6">
        <h2 className="text-[20px] font-semibold tracking-tight mb-1">Trade Distribution</h2>
        <p className="text-[13px] text-[#737373]">Win/Loss breakdown</p>
      </div>

      <div className="flex flex-col lg:flex-row items-center gap-8">
        <div className="w-full lg:w-1/2">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index]} stroke="none" />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-full lg:w-1/2 space-y-4">
          <div className="flex items-center justify-between p-4 border border-[#1a1a1a] bg-black/40">
            <div>
              <p className="text-[13px] text-[#737373] mb-1">Winning Trades</p>
              <p className="text-[24px] font-semibold text-[#10b981]">{wins}</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-[#737373] mb-1">Avg. Win</p>
              <p className="text-[16px] font-semibold text-[#10b981]">${formatCurrency(avgWin)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border border-[#1a1a1a] bg-black/40">
            <div>
              <p className="text-[13px] text-[#737373] mb-1">Losing Trades</p>
              <p className="text-[24px] font-semibold text-[#ef4444]">{losses}</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-[#737373] mb-1">Avg. Loss</p>
              <p className="text-[16px] font-semibold text-[#ef4444]">${formatCurrency(avgLoss)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
