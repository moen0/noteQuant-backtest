import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export function MetricCard({ label, value, change, isPositive, isPrimary = false, neutral = false }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const [displayValue, setDisplayValue] = useState('0');

  useEffect(() => {
    if (!isInView) return;

    const numericValue = parseFloat(value.replace(/[^0-9.-]/g, ''));
    if (isNaN(numericValue)) {
      setDisplayValue(value);
      return;
    }

    const duration = 1200;
    const startTime = Date.now();

    const animate = () => {
      const progress = Math.min((Date.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = numericValue * eased;

      if (value.includes('$')) {
        setDisplayValue(`$${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      } else if (value.includes('%')) {
        setDisplayValue(`${current.toFixed(1)}%`);
      } else {
        setDisplayValue(current % 1 === 0 ? Math.round(current).toString() : current.toFixed(2));
      }

      if (progress < 1) requestAnimationFrame(animate);
    };

    animate();
  }, [isInView, value]);

  const color = neutral ? 'text-[#fafafa]' : isPositive ? 'text-[#10b981]' : 'text-[#ef4444]';
  const changeLabel = typeof change === 'number' ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : change;

  return (
    <motion.div
      ref={ref}
      className={isPrimary ? 'col-span-2 md:col-span-1' : ''}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <div className="relative p-6 border border-[#262626] bg-[#0a0a0a] hover:border-[#404040] transition-colors h-full">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#737373] uppercase tracking-wider font-medium">
              {label}
            </span>
            {!neutral && (
              <span className={color}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isPositive ? (
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                  ) : (
                    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
                  )}
                </svg>
              </span>
            )}
          </div>
          <div className={`text-[32px] font-semibold tracking-tight ${color}`}>
            {displayValue}
          </div>
          {changeLabel && (
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className={color}>{changeLabel}</span>
              <span className="text-[#525252]">vs. initial</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
