import { useEffect, useState } from 'react';
import type { ProcessedOrder } from '../../../src/types';
import { STATUS, type StatusKey } from '../status';

interface Props {
  orders: ProcessedOrder[];
}

export function OrderCards({ orders }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Orders</h2>
        <span className="panel-note">status, weather, and the message the customer receives</span>
      </div>
      <div className="orders">
        {orders.map((order, index) => (
          <OrderCard key={order.order_id} order={order} index={index} />
        ))}
      </div>
    </section>
  );
}

function OrderCard({ order, index }: { order: ProcessedOrder; index: number }) {
  const key: StatusKey = order.error ? 'failed' : order.status === 'Delayed' ? 'delayed' : 'onTime';
  const status = STATUS[key];
  const message = useTypewriter(order.customer_message ?? '');

  return (
    <article className="order" style={{ animationDelay: `${index * 60}ms` }}>
      {order.weather && <Precipitation condition={order.weather.condition} />}

      <div className="order-top">
        <div>
          <div className="order-customer">{order.customer}</div>
          <div className="order-city">
            {order.order_id} · {order.city}
          </div>
        </div>
        <span className="badge" style={{ color: status.color }}>
          {status.glyph} {status.label}
        </span>
      </div>

      {order.weather && (
        <div className="order-weather">
          <span className="order-temp">{order.weather.tempC.toFixed(1)}°</span>
          <span>
            {order.weather.condition} · {order.weather.description}
          </span>
        </div>
      )}

      {order.customer_message && (
        <div className="order-message">
          {message}
          <div className="source-tag">{order.message_source === 'llm' ? 'written by claude' : 'template'}</div>
        </div>
      )}

      {order.error && (
        <div className="order-error">
          <div style={{ color: STATUS.failed.color }}>{order.error.kind}</div>
          <div>{order.error.message}</div>
          <div>
            {order.error.attempts} attempt{order.error.attempts === 1 ? '' : 's'} · left Pending for review
          </div>
        </div>
      )}
    </article>
  );
}

function Precipitation({ condition }: { condition: string }) {
  const kind = condition === 'Rain' ? 'rain' : condition === 'Snow' ? 'snow' : null;
  if (!kind) return null;

  return (
    <div className="precip" data-kind={kind} aria-hidden="true">
      {Array.from({ length: kind === 'snow' ? 14 : 20 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDuration: `${(kind === 'snow' ? 2.6 : 0.85) + ((i * 7) % 5) / 10}s`,
            animationDelay: `${((i * 13) % 20) / 10}s`,
          }}
        />
      ))}
    </div>
  );
}

function useTypewriter(text: string): string {
  const [shown, setShown] = useState('');

  useEffect(() => {
    if (!text) return setShown('');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(text);

    setShown('');
    let index = 0;
    const timer = setInterval(() => {
      index += 2;
      setShown(text.slice(0, index));
      if (index >= text.length) clearInterval(timer);
    }, 16);

    return () => clearInterval(timer);
  }, [text]);

  return shown;
}
