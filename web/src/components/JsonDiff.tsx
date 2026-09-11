import type { Order, ProcessedOrder } from '../../../src/types';

interface Props {
  seed: Order[];
  processed: ProcessedOrder[];
}

/**
 * The assignment asks for "the updated orders.json showing which orders were marked
 * Delayed". This is that file, next to what it started as.
 */
export function JsonDiff({ seed, processed }: Props) {
  const before = JSON.stringify(seed, null, 2).split('\n');
  const compact = processed.map(({ order_id, customer, city, status, customer_message }) => ({
    order_id,
    customer,
    city,
    status,
    ...(customer_message ? { customer_message } : {}),
  }));
  const after = JSON.stringify(compact, null, 2).split('\n');

  const changedStatuses = new Set(
    processed.filter((order, index) => order.status !== seed[index]?.status).map((order) => order.order_id),
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">orders.json</h2>
        <span className="panel-note">
          {changedStatuses.size} of {seed.length} orders changed status · weather detail omitted here for width
        </span>
      </div>
      <div className="diff">
        <Pane title="Before" lines={before} />
        <Pane
          title="After"
          lines={after}
          isChanged={(line) => line.includes('"status"') && line.includes('Delayed')}
          isAdded={(line) => line.includes('"customer_message"')}
        />
      </div>
    </section>
  );
}

interface PaneProps {
  title: string;
  lines: string[];
  isChanged?: (line: string) => boolean;
  isAdded?: (line: string) => boolean;
}

function Pane({ title, lines, isChanged, isAdded }: PaneProps) {
  return (
    <div className="diff-pane">
      <div className="diff-head">{title}</div>
      <div className="diff-body">
        {lines.map((line, index) => (
          <div
            className="diff-line"
            key={index}
            data-changed={isChanged?.(line) ?? false}
            data-added={isAdded?.(line) ?? false}
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}
