import { useCallback, useRef, useState } from 'react';
import type { Order, RunReport } from '../../src/types';
import type { RunEvent } from '../../src/telemetry';

/** Frames the server adds around the engine's own event stream. */
type StreamFrame =
  | RunEvent
  | { type: 'run:report'; seed: Order[]; report: RunReport }
  | { type: 'run:error'; message: string };

export interface RunState {
  events: RunEvent[];
  report: RunReport | null;
  seed: Order[] | null;
  running: boolean;
  error: string | null;
}

const IDLE: RunState = { events: [], report: null, seed: null, running: false, error: null };

export function useRunStream() {
  const [state, setState] = useState<RunState>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback((mode: 'live' | 'mock') => {
    sourceRef.current?.close();
    setState({ ...IDLE, running: true });

    const source = new EventSource(`/api/run?mode=${mode}`);
    sourceRef.current = source;

    source.onmessage = (message) => {
      const frame: StreamFrame = JSON.parse(message.data);

      if (frame.type === 'run:error') {
        source.close();
        setState((prev) => ({ ...prev, running: false, error: frame.message }));
        return;
      }

      if (frame.type === 'run:report') {
        source.close();
        setState((prev) => ({ ...prev, running: false, report: frame.report, seed: frame.seed }));
        return;
      }

      setState((prev) => ({ ...prev, events: [...prev.events, frame] }));
    };

    // The server closes the stream once the run ends, which EventSource surfaces as an
    // error; if a report already arrived that is a normal finish, not a failure.
    source.onerror = () => {
      source.close();
      setState((prev) =>
        prev.report ? { ...prev, running: false } : { ...prev, running: false, error: 'Lost connection to the pipeline server.' },
      );
    };
  }, []);

  return { ...state, start };
}
