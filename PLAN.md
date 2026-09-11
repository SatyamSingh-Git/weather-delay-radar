# Delay Radar — Implementation Plan

**Assignment:** AI Intern Assignment 2 — weather-aware order delay detection
**Stack:** TypeScript (Node 22) core + CLI + SSE server · Vite + React + Tailwind dashboard
**Repo name:** `weather-delay-radar`

---

## 0. Read of the brief

The literal ask is roughly one hour of work: read 4 orders, hit OpenWeatherMap concurrently,
flip the bad-weather ones to `Delayed`, write a nice apology string, don't crash on
`InvalidCity123`, keep the key in `.env`.

Almost every submission will do exactly that and look identical. The grading signal is not
"did it work" — it's **can you prove it works, and does the proof look like production
code**. So the plan below treats the spec as the floor and spends its effort on four things
a reviewer can see in thirty seconds:

1. **Visible proof of concurrency.** Not a `Promise.all` on line 40 that you have to take on
   faith — a measured waterfall showing four requests dispatched in the same millisecond,
   with a sequential-vs-parallel speedup number next to it.
2. **Resilience with a taxonomy**, not a bare `try/catch`. A 404 and a 503 are different
   failures and deserve different behaviour; showing you know the difference is the entire
   content of the "Resilience" section.
3. **A dashboard that looks like a real ops console**, streaming the run live.
4. **Docs that answer the reviewer's questions before they ask them.**

---

## 1. Deliverable → implementation map

Every line of the brief, and where it is satisfied. This table also goes in the README so a
reviewer can grade without reading source.

| Requirement | Satisfied by |
|---|---|
| `orders.json` as local DB, these exact cities | `data/orders.json`, byte-identical to the brief |
| Loop orders, fetch weather per city | `src/pipeline/run.ts` |
| **Concurrent**, not one-by-one | `Promise.all` fan-out over a semaphore; proven by `tests/concurrency.test.ts` and the live waterfall |
| Rain / Snow / Extreme → `Delayed` | `src/pipeline/classify.ts`, pure function over a policy table |
| AI "Weather-Aware Apology" function | `src/pipeline/apology.ts` — LLM tier + deterministic template tier |
| Handle `InvalidCity123`, log it, don't crash | Typed `CityNotFound`, non-fatal, run completes, exit code 0 |
| No hardcoded key, use `.env` | `src/config.ts` — loaded and schema-validated at boot, redacted in all output |
| Updated `orders.json` showing delays | `data/orders.processed.json` + an in-app before/after diff view |
| AI Log of prompts used | `AI_LOG.md` |
| Demo recording | a `--demo` mode built for camera; the shot list is kept outside the repo |

---

## 2. Architecture

One pure engine, three consumers. The engine knows nothing about terminals, HTTP servers, or
React — it emits events and returns a result.

```
data/orders.json
       │
       ▼
┌─────────────────────────────────────────────┐
│  core engine  (src/core, src/pipeline)      │
│                                             │
│  config → load orders → fan-out fetch       │
│     → classify → apologize → report         │
│                                             │
│  emits: run:start  order:dispatch           │
│         order:retry  order:resolved         │
│         order:failed  run:end               │
└─────────────────────────────────────────────┘
     │              │                 │
     ▼              ▼                 ▼
  cli.ts        server.ts          tests/
 (the script)   (SSE stream)       (Vitest)
                    │
                    ▼
                 web/ dashboard
```

**Why an event bus.** The CLI renderer and the browser dashboard are two views of the same
run. Threading a callback through would work; an emitter means the engine has exactly one
output contract and both consumers subscribe to it. It also makes telemetry — dispatch
timestamps, attempt counts, latencies — a first-class product of the run rather than
something scraped out of logs afterwards.

### 2.1 File layout

```
weather-delay-radar/
├─ README.md                  hero GIF, quickstart, requirement map, design notes
├─ ARCHITECTURE.md            diagrams, decision records, trade-offs
├─ AI_LOG.md                  prompts used, what the AI got wrong, what I rejected
├─ .env.example               OWM_API_KEY= plus tuning knobs
├─ .gitignore                 .env, node_modules, dist
├─ package.json  tsconfig.json  vitest.config.ts
├─ data/
│  ├─ orders.json             seed, exactly as given in the brief
│  └─ orders.processed.json   output deliverable
├─ src/
│  ├─ config.ts               env load + validate + redact; fails fast
│  ├─ types.ts                Order, WeatherSnapshot, RunReport, TimelineEntry
│  ├─ errors.ts               the failure taxonomy
│  ├─ result.ts               Result<T,E> — errors are values, not throws
│  ├─ telemetry.ts            typed event emitter + timeline recorder
│  ├─ http/
│  │  ├─ fetchWithRetry.ts    AbortController timeout, backoff + jitter, Retry-After
│  │  └─ limiter.ts           semaphore + in-flight dedup
│  ├─ weather/
│  │  ├─ client.ts            OpenWeatherMap → WeatherSnapshot
│  │  └─ mock.ts              a fake `fetch`, not a fake client, so offline mode
│  │                          exercises the real retry and parsing path
│  ├─ pipeline/
│  │  ├─ run.ts               the orchestrator
│  │  ├─ classify.ts          delay policy
│  │  └─ apology.ts           LLM tier + template tier
│  ├─ report/
│  │  ├─ console.ts           live CLI renderer
│  │  └─ writeJson.ts         atomic write of the processed orders
│  ├─ cli.ts                  entry point — "the script"
│  └─ server.ts               SSE + REST for the dashboard
├─ web/                       Vite + React + Tailwind
├─ tests/
└─ docs/
   ├─ screenshots/
```

---

## 3. The concurrency story (hero feature)

### 3.1 Implementation

- Build one task per order. Each task is wrapped so **it never rejects** — it resolves to
  `Result<WeatherSnapshot, WeatherError>`.
- Fan out with `Promise.all` over those tasks. Because failure is a value, `Promise.all`
  cannot short-circuit, and we still get typed per-order errors and per-attempt telemetry —
  which is why this beats reaching straight for `allSettled` (`allSettled` hands you
  `reason: unknown` and no attempt history). That reasoning goes in ARCHITECTURE.md.
- A semaphore (`MAX_CONCURRENCY`, default 8) sits inside each task. With 4 orders every task
  dispatches immediately; with 10,000 orders it degrades to a bounded pool instead of opening
  10,000 sockets. Same code path either way.
- An in-flight map dedupes identical cities, so N orders to Mumbai cost one HTTP request.

### 3.2 Proof

Recorded per attempt from a monotonic clock: `dispatchedAt`, `settledAt`, `attempt`,
`httpStatus`, `ms`. From that we derive:

- `wallMs` — real elapsed time
- `sequentialMs` — sum of individual latencies, i.e. what one-by-one would have cost
- `speedup` = `sequentialMs / wallMs`
- `maxOverlap` — peak simultaneous in-flight requests
- `dispatchSpreadMs` — spread between first and last dispatch

Rendered as a waterfall in both the terminal and the dashboard:

```
New York   ████████████                     412ms  Rain     DELAYED
Mumbai     █████████████████                587ms  Clear    on time
London     █████████                        321ms  Snow     DELAYED
Invalid…   ███                               96ms  404      FAILED
           ↑ all four dispatched at t+0.4ms
sequential 1416ms → parallel 587ms · 2.4× · peak overlap 4
```

The dashboard adds a toggle that overlays the ghosted sequential timeline behind the real
one. That single control is the most persuasive thing in the submission.

`tests/concurrency.test.ts` asserts it mechanically: dispatch spread < 20ms, `maxOverlap`
=== 4, `wallMs` < 60% of `sequentialMs`, raising `MAX_CONCURRENCY` above the order count
changes nothing, and lowering it to 1 collapses the speedup to ~1.

---

## 4. Resilience

### 4.1 Failure taxonomy

| Kind | Trigger | Retry? | Effect on the run |
|---|---|---|---|
| `CityNotFound` | HTTP 404 | no — permanent | order stays `Pending`, tagged `needs_review`, logged, run continues |
| `AuthError` | HTTP 401 | no | abort early with an actionable message (key missing / not yet active) |
| `RateLimited` | HTTP 429 | yes, honours `Retry-After` | transparent |
| `UpstreamError` | HTTP 5xx | yes, backoff | transparent |
| `NetworkError` | DNS / socket | yes | transparent |
| `Timeout` | exceeds `REQUEST_TIMEOUT_MS` | yes | transparent |
| `MalformedResponse` | schema mismatch | no | order flagged, run continues |

Retrying a 404 is the classic mistake here — it burns three round-trips and five seconds of
backoff to re-learn a permanent fact. Separating permanent from transient failure *is* the
Resilience requirement.

### 4.2 Guarantees

- The `InvalidCity123` order never propagates an exception. The other three complete.
- Process exits `0`. A partial failure is a reported outcome, not a crash.
- Backoff is `min(base · 2ⁿ, cap)` with full jitter, so retries don't synchronise.
- Every request carries an `AbortController` deadline — a hung socket cannot stall the run.
- `orders.processed.json` is written atomically (temp file + rename), so a crash mid-write
  can't leave a truncated deliverable.

### 4.3 Security

- `OWM_API_KEY` read from `.env` via `dotenv`, validated at boot with a clear failure if
  absent. Never inlined.
- `.env` gitignored; `.env.example` committed.
- The key is stripped from every logged URL and from every SSE frame — the dashboard runs in
  a browser and must never receive it.

---

## 5. The apology engine

```
generateApology({ customer, city, condition, description, tempC }) → { text, source }
```

**Tier 1 — LLM.** If `ANTHROPIC_API_KEY` is present, call Claude with a tight system prompt
(one or two sentences, warm, name the city and the actual condition, invent no compensation
and no delivery date), low temperature, small `max_tokens`, hard timeout. You don't have a
key today, so this ships behind a flag — fully written, unit-tested against a mocked client,
and documented in the README as one env var away.

**Tier 2 — template.** A condition-keyed phrase bank that reads the API's own `description`
field, so "light rain" and "heavy intensity rain" produce different copy instead of one
generic sentence. This is the default path and it reproduces the brief's sample output
exactly:

> "Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your
> patience!"

Tier 2 is also the fallback whenever Tier 1 errors or times out, so runs stay deterministic
and offline-safe. Tests pin the template output; the LLM path is tested with a stub.

*(The brief's "AI Challenge" most likely just means "use an AI tool to help you write this
function" — that reading is covered in `AI_LOG.md`. Building the runtime LLM path as well
costs little and covers the stronger reading.)*

---

## 6. Classification policy

```
DELAY_CONDITIONS = ["Rain", "Snow", "Extreme"]   // exactly as specified
```

Case-insensitive match on the API's `weather[0].main`. Overridable via env, but the committed
default is literally the brief's set — no scope creep into "Thunderstorm feels severe too".

One detail worth documenting: OpenWeatherMap's current API doesn't actually emit `Extreme` as
a `main` value; it's a legacy group covering `Tornado`, `Squall`, and `Ash`. So the policy
table carries an alias map for those, off by default, and ARCHITECTURE.md explains why.
Reading the upstream docs closely enough to notice this is itself a signal.

---

## 7. The dashboard

Dark, committed ops-console aesthetic — Linear/Vercel register, not Bootstrap. Near-black
`#0A0B0D` ground, one restrained aurora gradient, hairline `rgba(255,255,255,.08)` borders,
Inter for text and JetBrains Mono for every number. Cyan = on time, amber = delayed,
rose = failed.

**Layout, top to bottom:**

1. **Header** — title, live connection pill, `Run Pipeline` CTA, Live/Mock toggle.
2. **KPI row** — Orders · Delayed · On-time · Failed · Wall clock · Speedup. Numbers count up
   as the run streams in.
3. **Concurrency waterfall** *(hero)* — hand-rolled SVG Gantt. One bar per city, x-axis in ms
   from `t0`, retry attempts as segmented sub-bars with dashed backoff connectors, hover for
   status code and latency, and the sequential-ghost overlay toggle.
4. **Order cards** — customer, city, condition, temp, animated badge flipping
   `Pending → Delayed`, and the apology revealed with a typewriter effect. Delayed cards get a
   subtle CSS rain/snow particle layer keyed to the real condition. Failed cards show the
   error-kind chip and the attempt history.
5. **Event log** — streaming monospace console, colour-coded, filterable, auto-scrolling.
6. **JSON diff** — before/after `orders.json` side by side with changed lines highlighted.
   This *is* the "updated orders.json" deliverable, made visual.

Live data arrives over SSE from `GET /api/run`. The server runs the same engine the CLI does
and forwards its events; no logic is duplicated in the browser. Charts are hand-written SVG —
for a Gantt that's less code than configuring a chart library, and it looks better.

Dependencies kept deliberately small. *(Built as: React plus plain CSS custom properties —
Tailwind and framer-motion were dropped during implementation once it was clear the token
set was small enough to hand-write and the animations were a handful of keyframes. No chart
library, no map library, no component kit.)*

---

## 8. Test plan (Vitest, fully mocked, no network)

| File | Proves |
|---|---|
| `classify.test.ts` | Rain/Snow/Extreme delay; Clear/Clouds don't; case-insensitive; policy override honoured |
| `concurrency.test.ts` | dispatch spread, peak overlap, wall-clock < sequential, semaphore actually caps |
| `retry.test.ts` | 500→200 succeeds on attempt 2; **404 attempted exactly once**; 429 honours `Retry-After`; timeout fires at the deadline; backoff bounded |
| `resilience.test.ts` | `InvalidCity123` fails while the other three resolve; exit code 0; error present in the report |
| `apology.test.ts` | template contains name/city/condition and matches the brief's sample; LLM tier used when available, falls back on throw |
| `dedup.test.ts` | duplicate cities collapse to one HTTP call |
| `pipeline.e2e.test.ts` | full run against the mock client; snapshot of the written `orders.processed.json` |

Green tests are the cheapest credibility in the whole submission.

---

## 9. Zero-setup demo mode

`npm run demo` runs against `src/weather/mock.ts` — deterministic fixtures with realistic
staggered latency and one injected transient 503 so the retry logic is visible on camera. No
API key, no network. A reviewer who won't sign up for an OpenWeatherMap key can still run the
whole thing in fifteen seconds, which is worth more than any README paragraph.

`npm start` is the real thing, against the live API with your key.

---

## 10. Build order

| Phase | Output |
|---|---|
| P0 | `git init`, scaffold, `package.json`, `tsconfig`, `.env.example`, seed `data/orders.json` |
| P1 | `types` · `errors` · `result` · `config` · `limiter` · `fetchWithRetry` · `weather/client` · `weather/mock` |
| P2 | `telemetry` · `classify` · `apology` · `pipeline/run` |
| P3 | `report/console` · `report/writeJson` · `cli.ts` — **the brief is fully satisfied at the end of P3** |
| P4 | full Vitest suite, green |
| P5 | `server.ts` with SSE |
| P6 | `web/` dashboard |
| P7 | README · ARCHITECTURE · AI_LOG · screenshots |

P3 is the checkpoint: if everything after it vanished, the assignment would still be complete
and correct. Everything from P4 on is the differentiator.

---

## 11. Open items

- Live verification needs your `OWM_API_KEY` in `.env`. Free-tier keys take ~10 minutes to a
  couple of hours to activate after signup — until then live mode returns 401, which the
  `AuthError` path already reports as an actionable message rather than a stack trace.
- The demo recording itself is yours to capture; the shot
  list and a ~90-second narration.
