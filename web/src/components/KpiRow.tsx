import { useEffect, useRef, useState } from 'react';
import type { RunMetrics } from '../../../src/types';
import { STATUS } from '../status';

interface Props {
  metrics: RunMetrics | null;
}

export function KpiRow({ metrics }: Props) {
  return (
    <div className="kpis">
      <Kpi label="Orders" value={metrics?.total ?? 0} />
      <Kpi label="Delayed" value={metrics?.delayed ?? 0} status="delayed" />
      <Kpi label="On time" value={metrics?.onTime ?? 0} status="onTime" />
      <Kpi label="Failed" value={metrics?.failed ?? 0} status="failed" />
      <Kpi label="Wall clock" value={metrics?.wallMs ?? 0} unit="ms" caption={`${metrics?.httpRequests ?? 0} requests`} />
      <Kpi
        label="Speedup"
        value={metrics?.speedup ?? 0}
        unit="×"
        decimals={1}
        accent
        caption={metrics ? `vs ${Math.round(metrics.sequentialMs)}ms one by one` : 'vs one by one'}
      />
    </div>
  );
}

interface KpiProps {
  label: string;
  value: number;
  unit?: string;
  caption?: string;
  decimals?: number;
  accent?: boolean;
  status?: keyof typeof STATUS;
}

function Kpi({ label, value, unit, caption, decimals = 0, accent, status }: KpiProps) {
  const shown = useCountUp(value);
  const badge = status ? STATUS[status] : null;

  return (
    <div className="kpi">
      <div className="kpi-label">
        {badge && <span style={{ color: badge.color }}>{badge.glyph}</span>}
        {label}
      </div>
      <div className="kpi-value" style={accent ? { color: 'var(--accent)' } : undefined}>
        {shown.toFixed(decimals)}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {caption && <div className="kpi-caption">{caption}</div>}
    </div>
  );
}

/** Counts to the new value over ~400ms so a finished run lands rather than snaps. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / 400, 1);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}
