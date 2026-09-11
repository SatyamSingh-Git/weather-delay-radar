import { useEffect, useRef } from 'react';
import type { RunEvent } from '../../../src/telemetry';
import { STATUS } from '../status';

interface Props {
  events: RunEvent[];
}

export function EventLog({ events }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Event stream</h2>
        <span className="panel-note">emitted by the engine, rendered here and in the CLI</span>
      </div>
      <div className="log">
        {events.length === 0 && <div className="log-empty">Waiting for a run…</div>}
        {events.map((event, index) => {
          const line = describe(event);
          if (!line) return null;
          return (
            <div className="log-line" key={index}>
              <span className="log-at">+{Math.round(event.at)}ms</span>
              <span style={line.color ? { color: line.color } : undefined}>{line.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function describe(event: RunEvent): { text: string; color?: string } | null {
  switch (event.type) {
    case 'run:start':
      return { text: `run ${event.runId} · ${event.mode} · ${event.orderCount} orders · max concurrency ${event.maxConcurrency}` };
    case 'order:dispatch':
      return { text: `→ GET ${event.city}${event.attempt > 1 ? ` (attempt ${event.attempt})` : ''}` };
    case 'order:attempt':
      return { text: `   ${event.status ?? 'no response'} in ${event.ms}ms` };
    case 'order:retry':
      return { text: `↻ ${event.orderId} ${event.reason} — retrying in ${event.delayMs}ms`, color: STATUS.delayed.color };
    case 'order:resolved':
      return { text: `✓ ${event.weather.resolvedCity} ${event.weather.condition} ${event.weather.tempC.toFixed(1)}°C`, color: STATUS.onTime.color };
    case 'order:failed':
      return { text: `✗ ${event.orderId} ${event.error.kind}: ${event.error.message}`, color: STATUS.failed.color };
    case 'order:classified':
      return event.status === 'Delayed'
        ? { text: `⚑ ${event.orderId} → Delayed (${event.reason})`, color: STATUS.delayed.color }
        : { text: `  ${event.orderId} stays Pending` };
    case 'order:apology':
      return { text: `✎ ${event.orderId} "${event.text}"` };
    case 'run:end':
      return {
        text: `done · wall ${event.metrics.wallMs}ms · ${event.metrics.speedup}× faster than sequential · peak overlap ${event.metrics.maxOverlap}`,
      };
    default:
      return null;
  }
}
