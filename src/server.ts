import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { loadConfig } from './config';
import { defaultHttpDeps } from './http/fetchWithRetry';
import { runPipeline } from './pipeline/run';
import { readOrders, writeOrders } from './report/writeJson';
import { createEventBus } from './telemetry';
import { createOpenWeatherClient } from './weather/client';
import { createMockFetch } from './weather/mock';

const PORT = Number(process.env.PORT ?? 5174);
const WEB_DIST = resolve('web/dist');

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (url.pathname === '/api/orders') return sendJson(response, 200, await readOrders(resolve('data/orders.json')));
  if (url.pathname === '/api/run') return streamRun(url, response);
  return serveStatic(url.pathname, response);
});

/**
 * The dashboard subscribes to the same event bus the CLI renders from, so the browser
 * is a second view of one run rather than a reimplementation of the pipeline.
 */
async function streamRun(url: URL, response: ServerResponse): Promise<void> {
  const mode = url.searchParams.get('mode') === 'live' ? 'live' : 'mock';

  // The stream opens before anything can fail. An error status here would reach the
  // browser as a bare EventSource `error` event with no body, so a missing API key would
  // surface as "lost connection" rather than as the thing that actually went wrong.
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);

  const bus = createEventBus();
  bus.subscribe(send);

  try {
    const config = loadConfig({ mode });
    const orders = await readOrders(config.ordersPath);
    const client = createOpenWeatherClient(
      config,
      mode === 'mock' ? { ...defaultHttpDeps, fetchImpl: createMockFetch() } : defaultHttpDeps,
    );

    const report = await runPipeline({ config, orders, client, bus });
    if (!report.aborted) await writeOrders(config.outputPath, report.orders);

    send({ type: 'run:report', seed: orders, report });
  } catch (error) {
    send({ type: 'run:error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    response.end();
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requested = join(WEB_DIST, normalize(pathname === '/' ? 'index.html' : pathname));
  const target = requested.startsWith(WEB_DIST) ? requested : join(WEB_DIST, 'index.html');

  try {
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    sendJson(response, 404, {
      error: 'Dashboard bundle not found. Run `npm run dev` for the live dev server, or `npm run build:web` first.',
    });
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

server.listen(PORT, () => {
  console.log(`  Delay Radar API on http://localhost:${PORT}`);
});
