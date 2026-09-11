import { useState } from 'react';
import type { RunReport, TaskTimeline } from '../../../src/types';
import { STATUS } from '../status';

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 13;
const LABEL_WIDTH = 132;
const META_WIDTH = 158;
const PLOT_WIDTH = 620;
const AXIS_HEIGHT = 26;
const MIN_BAR = 3;

interface Props {
  report: RunReport;
}

interface Hover {
  x: number;
  y: number;
  text: string;
}

/**
 * The point of this chart is the left edge: every bar starts at t+0 because every
 * request was dispatched on the same tick. The ghost overlay redraws the same work
 * end-to-end, which is what a loop with `await` inside it would have cost.
 */
export function Waterfall({ report }: Props) {
  const [showGhost, setShowGhost] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  const { timeline, metrics } = report;
  const span = showGhost ? Math.max(metrics.sequentialMs, metrics.wallMs) : Math.max(metrics.wallMs, 1);
  const scale = (ms: number) => (ms / span) * PLOT_WIDTH;
  const height = timeline.length * ROW_HEIGHT + AXIS_HEIGHT;

  let ghostCursor = 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Concurrency waterfall</h2>
        <span className="panel-note">milliseconds from the start of the run</span>
        <span className="spacer" />
        <label className="checkbox">
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
          Overlay sequential
        </label>
      </div>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: STATUS.onTime.color }} /> Completed
        </span>
        <span>
          <i className="swatch" style={{ background: STATUS.failed.color }} /> Failed
        </span>
        <span>
          <i className="swatch" style={{ background: STATUS.delayed.color }} /> Retried attempt
        </span>
        {showGhost && (
          <span>
            <i className="swatch ghost" style={{ background: 'var(--text-muted)', opacity: 0.4 }} /> If run one by one
          </span>
        )}
      </div>

      <div className="chart-scroll">
        <svg
          width={LABEL_WIDTH + PLOT_WIDTH + META_WIDTH}
          height={height}
          role="img"
          aria-label={`Request timings for ${timeline.length} cities. All dispatched within ${metrics.dispatchSpreadMs} milliseconds of each other; peak overlap ${metrics.maxOverlap}.`}
        >
          {ticks(span).map((tick) => (
            <g key={tick} className="tick">
              <line
                x1={LABEL_WIDTH + scale(tick)}
                x2={LABEL_WIDTH + scale(tick)}
                y1={0}
                y2={height - AXIS_HEIGHT}
                stroke="var(--hairline)"
              />
              <text x={LABEL_WIDTH + scale(tick)} y={height - 8} textAnchor="middle">
                {tick}ms
              </text>
            </g>
          ))}

          {timeline.map((task, index) => {
            const y = index * ROW_HEIGHT;
            const ghostWidth = task.attempts.reduce((sum, a) => sum + a.ms, 0);
            const ghostX = ghostCursor;
            ghostCursor += ghostWidth;

            return (
              <g key={task.order_id} className="bar-row">
                <text x={0} y={y + 20} className="row-city">
                  {task.city.length > 15 ? `${task.city.slice(0, 14)}…` : task.city}
                </text>

                {showGhost && (
                  <rect
                    className="ghost"
                    x={LABEL_WIDTH + scale(ghostX)}
                    y={y + 8}
                    width={Math.max(MIN_BAR, scale(ghostWidth))}
                    height={BAR_HEIGHT}
                    rx={4}
                  />
                )}

                {task.attempts.map((attempt) => {
                  const failed = attempt.outcome !== 'ok';
                  const color = attempt.outcome === 'ok' ? STATUS.onTime.color : attempt.outcome === 'retried' ? STATUS.delayed.color : STATUS.failed.color;
                  const label = [
                    `${task.city} · attempt ${attempt.attempt}`,
                    `${attempt.status ?? attempt.errorKind ?? 'no response'} · ${attempt.ms}ms`,
                    `${attempt.dispatchedAt}ms → ${attempt.settledAt}ms`,
                  ].join('\n');

                  return (
                    <rect
                      key={attempt.attempt}
                      className="bar"
                      x={LABEL_WIDTH + scale(attempt.dispatchedAt)}
                      y={y + 8}
                      // A 2px gap keeps adjacent attempt segments from fusing into one bar.
                      width={Math.max(MIN_BAR, scale(attempt.ms) - 2)}
                      height={BAR_HEIGHT}
                      rx={4}
                      fill={color}
                      opacity={failed ? 0.75 : 1}
                      onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, text: label })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}

                <text x={LABEL_WIDTH + PLOT_WIDTH + 12} y={y + 20} className="row-meta">
                  {task.totalMs}ms · {statusCodes(task)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.text}
        </div>
      )}
    </section>
  );
}

const statusCodes = (task: TaskTimeline) =>
  task.attempts.map((a) => a.status ?? a.errorKind ?? '—').join(' → ');

function ticks(span: number): number[] {
  const step = niceStep(span / 5);
  const out: number[] = [];
  for (let value = 0; value <= span; value += step) out.push(Math.round(value));
  return out;
}

function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const normalised = rough / magnitude;
  const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
  return step * magnitude;
}
