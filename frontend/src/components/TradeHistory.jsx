import { useState, useMemo } from 'react';
import { motion } from 'motion/react';

function formatCurrency(value) {
    const abs = Math.abs(value);
    const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return value >= 0 ? `+$${formatted}` : `$-${formatted}`;
}

const ROWS_PER_PAGE = 10;

export function TradeHistory({ trades = [] }) {
    const [page, setPage] = useState(1);
    const [pairFilter, setPairFilter] = useState('all');
    const [timeFilter, setTimeFilter] = useState('all');

    const pairs = useMemo(() => {
        const set = new Set(trades.map((t) => t.pair ?? 'GBP/JPY'));
        return ['all', ...Array.from(set).sort()];
    }, [trades]);

    const filtered = useMemo(() => {
        let result = trades.slice().sort((a, b) => new Date(b.exit_time) - new Date(a.exit_time));

        if (pairFilter !== 'all') {
            result = result.filter((t) => (t.pair ?? 'GBP/JPY') === pairFilter);
        }

        if (timeFilter !== 'all') {
            const now = new Date();
            const cutoff = new Date(now);
            if (timeFilter === '7d') cutoff.setDate(now.getDate() - 7);
            else if (timeFilter === '30d') cutoff.setDate(now.getDate() - 30);
            else if (timeFilter === '90d') cutoff.setDate(now.getDate() - 90);
            result = result.filter((t) => new Date(t.exit_time) >= cutoff);
        }

        return result;
    }, [trades, pairFilter, timeFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    const safeCurrentPage = Math.min(page, totalPages);
    const pageSlice = filtered.slice((safeCurrentPage - 1) * ROWS_PER_PAGE, safeCurrentPage * ROWS_PER_PAGE);

    const getPageNumbers = () => {
        const pages = [];
        const start = Math.max(1, safeCurrentPage - 2);
        const end = Math.min(totalPages, start + 4);
        for (let i = start; i <= end; i++) pages.push(i);
        return pages;
    };

    return (
        <div className="border border-[#262626] bg-[#0a0a0a]">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4 p-6 border-b border-[#262626]">
                <div>
                    <h2 className="text-[20px] font-semibold tracking-tight mb-1">Trade History</h2>
                    <p className="text-[13px] text-[#525252] font-mono">{filtered.length} trades</p>
                </div>
                <div className="flex gap-3">
                    <select
                        className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
                        value={pairFilter}
                        onChange={(e) => { setPairFilter(e.target.value); setPage(1); }}
                    >
                        {pairs.map((p) => (
                            <option key={p} value={p}>{p === 'all' ? 'All Pairs' : p}</option>
                        ))}
                    </select>
                    <select
                        className="border border-[#262626] bg-black text-[#fafafa] font-mono text-[13px] px-3 py-2 outline-none focus:border-[#404040] transition-colors"
                        value={timeFilter}
                        onChange={(e) => { setTimeFilter(e.target.value); setPage(1); }}
                    >
                        <option value="all">All Time</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                    <tr className="border-b border-[#262626]">
                        {['ID', 'Date', 'Time', 'Pair', 'Type', 'Entry', 'Exit', 'P/L', 'Status'].map((h) => (
                            <th key={h} className="px-6 py-4 text-[11px] text-[#525252] font-mono uppercase tracking-widest font-medium">
                                {h}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {pageSlice.length === 0 ? (
                        <tr>
                            <td colSpan={9} className="px-6 py-12 text-center text-[#525252] font-mono text-sm">
                                No trades found.
                            </td>
                        </tr>
                    ) : (
                        pageSlice.map((trade, index) => {
                            const globalIndex = (safeCurrentPage - 1) * ROWS_PER_PAGE + index;
                            const isWin = trade.pnl > 0;
                            const enterDate = new Date(trade.enter_time);
                            const exitDate = new Date(trade.exit_time);
                            const dateStr = exitDate.toLocaleDateString('en-CA');
                            const timeStr = exitDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                            const pair = trade.pair ?? 'GBP/JPY';
                            const direction = trade.direction === 'long' ? 'BUY' : 'SELL';

                            return (
                                <motion.tr
                                    key={`${trade.enter_time}-${index}`}
                                    className="border-b border-[#1a1a1a] hover:bg-[#111111] transition-colors"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: index * 0.03 }}
                                >
                                    <td className="px-6 py-4 text-[13px] text-[#525252] font-mono">#{globalIndex + 1}</td>
                                    <td className="px-6 py-4 text-[14px] font-mono">{dateStr}</td>
                                    <td className="px-6 py-4 text-[14px] text-[#737373] font-mono">{timeStr}</td>
                                    <td className="px-6 py-4 text-[14px] font-semibold">{pair}</td>
                                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 text-[12px] font-semibold font-mono ${
                          direction === 'BUY'
                              ? 'bg-[#10b981] text-black'
                              : 'bg-[#ef4444] text-black'
                      }`}>
                        {direction}
                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-[14px] font-mono text-[#737373]">{trade.enter_price.toFixed(5)}</td>
                                    <td className="px-6 py-4 text-[14px] font-mono text-[#737373]">{trade.exit_price.toFixed(5)}</td>
                                    <td className={`px-6 py-4 text-[14px] font-semibold font-mono ${isWin ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                                        {formatCurrency(trade.pnl)}
                                    </td>
                                    <td className="px-6 py-4">
                      <span className="px-3 py-1 border border-[#262626] text-[12px] font-mono text-[#737373]">
                        Closed
                      </span>
                                    </td>
                                </motion.tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-[#262626]">
                    <p className="text-[13px] text-[#525252] font-mono">
                        Showing {(safeCurrentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(safeCurrentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length} trades
                    </p>
                    <div className="flex gap-1">
                        <button
                            className="px-3 py-1.5 text-[13px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            disabled={safeCurrentPage <= 1}
                            onClick={() => setPage(safeCurrentPage - 1)}
                        >
                            Previous
                        </button>
                        {getPageNumbers().map((p) => (
                            <button
                                key={p}
                                className={`px-3 py-1.5 text-[13px] font-mono border transition-colors ${
                                    p === safeCurrentPage
                                        ? 'bg-[#fafafa] text-black border-[#fafafa]'
                                        : 'border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040]'
                                }`}
                                onClick={() => setPage(p)}
                            >
                                {p}
                            </button>
                        ))}
                        <button
                            className="px-3 py-1.5 text-[13px] font-mono border border-[#262626] text-[#737373] hover:text-[#fafafa] hover:border-[#404040] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            disabled={safeCurrentPage >= totalPages}
                            onClick={() => setPage(safeCurrentPage + 1)}
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}