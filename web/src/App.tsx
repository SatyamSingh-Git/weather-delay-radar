import { useEffect, useRef, useState } from 'react';
import { EventLog } from './components/EventLog';
import { JsonDiff } from './components/JsonDiff';
import { KpiRow } from './components/KpiRow';
import { OrderCards } from './components/OrderCards';
import { Waterfall } from './components/Waterfall';
import { useRunStream } from './useRunStream';

export function App() {
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const { events, report, seed, running, error, start } = useRunStream();
  const autoRan = useRef(false);

  // ?run=mock / ?run=live starts a run on load, which is what the demo recording and
  // any "just show me" link want.
  useEffect(() => {
    if (autoRan.current) return;
    const requested = new URLSearchParams(window.location.search).get('run');
    if (requested !== 'mock' && requested !== 'live') return;

    autoRan.current = true;
    setMode(requested);
    start(requested);
  }, [start]);

  return (
    <div className="shell">
      <header className="header">
        <h1 className="wordmark">Delay Radar</h1>
        <span className="pill">
          <i className="dot" data-live={running} />
          {running ? 'running' : report ? `run ${report.runId}` : 'idle'}
        </span>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Data source">
          <button aria-pressed={mode === 'mock'} onClick={() => setMode('mock')} disabled={running}>
            Offline fixtures
          </button>
          <button aria-pressed={mode === 'live'} onClick={() => setMode('live')} disabled={running}>
            Live API
          </button>
        </div>
        <button className="run-button" onClick={() => start(mode)} disabled={running}>
          {running ? 'Running…' : 'Run pipeline'}
        </button>
      </header>

      <p className="tagline">
        Fetches weather for every order at once, flags the ones heading into rain, snow or extreme
        conditions, and writes each affected customer a note. The chart below is the evidence that the
        requests really did go out together.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <KpiRow metrics={report?.metrics ?? null} />

      {report && <Waterfall report={report} />}

      <EventLog events={events} />

      {report && <OrderCards orders={report.orders} />}

      {report && seed && <JsonDiff seed={seed} processed={report.orders} />}

      <p className="footnote">
        Offline fixtures replace only `fetch` — retry, backoff, status handling and parsing are the same
        code the live path runs. The API key never leaves the server.
      </p>
    </div>
  );
}
