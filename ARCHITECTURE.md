# Architecture

## Shape

One engine, three consumers. The engine emits events and returns a report; it knows nothing
about terminals, HTTP servers, or React.

```
data/orders.json
       │
       ▼
┌──────────────────────────────────────────────┐
│  engine                                      │
│                                              │
│  config ─► load orders ─► fan-out fetch      │
│         ─► classify ─► apologize ─► report   │
│                                              │
│  emits: run:start · order:dispatch           │
│         order:retry · order:resolved         │
│         order:failed · order:classified      │
│         order:apology · run:end              │
└──────────────────────────────────────────────┘
     │              │                 │
     ▼              ▼                 ▼
  cli.ts        server.ts          tests/
 (the script)  (SSE stream)        (Vitest)
                    │
                    ▼
              web/ dashboard
```

The CLI renderer and the browser dashboard subscribe to the same bus, so the dashboard is a
second *view* of a run rather than a second *implementation* of the pipeline. It also means
telemetry — dispatch timestamps, attempt counts, latencies — is a product of the run rather
than something reconstructed from logs afterwards.

---

## Decisions

### `Promise.all` over `Promise.allSettled`

The reflex when one task always fails is `allSettled`, and it would work. But each task is
already wrapped to resolve to `Result<WeatherSnapshot, WeatherError>` rather than reject
([src/result.ts](src/result.ts)), so there is nothing for `Promise.all` to short-circuit on.

Keeping `all` buys two things `allSettled` gives up:

- **A typed error.** `allSettled` hands back `reason: unknown`. The report needs the error
  *kind* to decide whether the order is retryable, reviewable, or fatal.
- **Per-attempt history.** The waterfall needs every attempt's dispatch time, settle time and
  status code. Those are collected through hooks during the request, not from the settled
  value.

The general form of the decision: `allSettled` is how you cope with tasks that reject; not
rejecting is better than coping.

### A semaphore, for four orders

With `MAX_CONCURRENCY=8` and four orders the semaphore never blocks — every task dispatches on
the same tick. It's there so the identical code path survives an order book of ten thousand
without opening ten thousand sockets. The tests exercise both ends: at `1` the run measurably
serialises, at `2` peak overlap is exactly 2.

One subtlety worth the two extra lines it costs: a finishing task hands its permit *directly*
to the next waiter rather than decrementing and letting the waiter re-take it. The obvious
version leaves a microtask-sized window in which a fresh caller sees a free slot that is
already spoken for — measured, that version runs at twice its stated limit under interleaved
arrivals. [tests/limiter.test.ts](tests/limiter.test.ts) pins peak concurrency at limits 1, 2
and 3 with callers injected across forty microtask depths.

An in-flight deduper sits alongside it, so N orders shipping to the same city cost one HTTP
request. The four sample cities are distinct, so this never fires on the assignment data —
[tests/concurrency.test.ts](tests/concurrency.test.ts) covers it directly instead.

### Errors as values

`Result<T, E>` rather than exceptions across the task boundary. Exceptions are the wrong tool
for a 404 here: it's an expected outcome for one of the four inputs, and the pipeline's job is
to *record* it, not to unwind. Exceptions remain for genuinely exceptional things — a
malformed orders file, a missing key at boot.

### Permanent vs. transient

The retry policy branches on which failures could plausibly resolve themselves:

- **404** — the city is not in the gazetteer. It won't be on attempt two. One attempt.
- **401/403** — the key is wrong or not yet activated. Retrying it once per city turns one
  clear error into four confusing ones, so it's *fatal*: it trips a shared `AbortController`,
  the run stops, and one actionable message comes back.
- **429** — honour `Retry-After` when the server sends it. Guessing is strictly worse than
  being told.
- **5xx / network / timeout** — retry with `min(base · 2ⁿ, cap)` and **full jitter**.

Jitter matters specifically because this is a fan-out: without it, every retry from the same
batch fires on the same tick and re-collides.

Backoff protects against a server that answers slowly. It does nothing about one that never
answers, so every attempt also carries an `AbortController` deadline.

### Offline mode is a fake `fetch`, not a fake client

`createMockFetch()` ([src/weather/mock.ts](src/weather/mock.ts)) is injected at the lowest
possible seam. Everything above it — retry, backoff, status classification, JSON parsing,
schema validation — is the same code the live path runs. A mock client one layer higher would
have bypassed exactly the logic most worth demonstrating, and `npm run demo` would prove
nothing about the real pipeline.

One fixture returns a 503 on its first attempt, so a demo run exercises the retry path.

### The delay policy is data

`DELAY_CONDITIONS` defaults to exactly the three conditions the assignment names, matched
case-insensitively against `weather[0].main`.

`Extreme` is worth a note: OpenWeatherMap's current API doesn't emit it. It was a grouping in
the older API, and `Tornado`, `Squall` and `Ash` are what remain of it. Silently expanding the
policy to cover those would be inventing a requirement; ignoring the discrepancy would leave a
condition that never fires. So the aliases exist behind `EXTREME_ALIASES=false` and are
documented — the shipped behaviour is the specification, and the gap is visible.

Not included: `Thunderstorm`. It feels severe, but the brief lists three conditions.

### Two apology tiers, template first

The template is the default and the fallback. It reads the API's own `description` field, so
the copy tracks the actual weather rather than the bucket — `light snow` and `heavy intensity
rain` produce different sentences. The one transformation is dropping OpenWeatherMap's
internal word "intensity", which is how the API writes it and not how a person does.

The model tier activates on `ANTHROPIC_API_KEY` and degrades to the template on any error,
timeout, or refusal. Keeping the deterministic tier as the default means tests pin exact
strings and the pipeline works with no network.

Apologies are fanned out with `Promise.all` for the same reason the fetches are: with the LLM
tier on they're network calls, and Bob shouldn't wait for Alice's sentence.

### Hand-written SVG for the waterfall

A segmented Gantt with per-attempt bars, retry gaps, a hover layer and a ghost overlay is
about sixty lines of SVG. Configuring a chart library to produce the same thing is more code
and less control, and adds a dependency to draw rectangles.

Colours are the reserved **status** palette (good / warning / critical), validated for
colour-vision separation and ≥3:1 contrast against the dashboard surface. Every status is
carried by a glyph and a text label as well as a hue, so nothing depends on colour alone.

### Writing the deliverable

`orders.processed.json` is written to a temp file and renamed. A rename is atomic on both
POSIX and Windows, so an interrupted run cannot leave a half-written deliverable behind.

The output preserves all four original fields verbatim and adds detail alongside them, so it
is a drop-in replacement for the input rather than a different document.

---

## What I'd do next

- **Persist runs.** Everything is in-memory; a real deployment would want run history to spot
  a city that fails repeatedly.
- **A circuit breaker.** With four cities, retry is enough. With thousands, a provider having
  a bad hour deserves to be shed rather than hammered.
- **Cache by city with a short TTL.** Weather doesn't change per-second, and an order book has
  heavy city overlap. The deduper is the in-flight case of this; the durable case is a cache.
- **Webhook out.** Flipping an order to `Delayed` should notify something, not just write JSON.
