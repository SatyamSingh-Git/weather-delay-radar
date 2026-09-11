# Demo recording — shot list

Target: **90 seconds**. Record at 1920×1080, browser zoom 100%, terminal font ~16pt.

Before you start:

```bash
npm install && npm run build:web
rm -f data/orders.processed.json      # so the "after" file appears during the take
```

Have two things open: a terminal in the project root, and `npm run dev` already running in a
second terminal (the browser tab points at <http://localhost:5173>).

---

## Shot 1 — the script (0:00–0:35)

Terminal, full screen. Type it live:

```bash
npm run demo
```

*(Use `npm start` instead only if your OpenWeatherMap key is active — check first. Real
weather also won't reliably give you rain on camera, which is why the fixtures are the
default take. Either way the code path is identical; offline mode replaces only `fetch`.)*

> "Four orders, four different cities. The script fetches weather for all of them
> concurrently — and rather than asking you to take that on faith, it measures it."

Let the dispatch lines land, then point at them:

> "All four requests go out inside about a millisecond of each other. London's first attempt
> comes back 503, so it backs off and retries — that's the second segment on its bar."

When the waterfall prints:

> "Sequential would have been about 1.7 seconds. Wall clock is 620 milliseconds. Peak overlap
> four — that's four requests genuinely in flight, not a fast loop."

Then the orders block:

> "New York is rain and London is snow, so both flip to Delayed and each customer gets a
> message built from the actual forecast — 'heavy rain' for one, 'light snow' for the other.
> Mumbai is clear and stays put."

And the failure:

> "InvalidCity123 404s. It's logged, tagged for review, and the run still finishes clean —
> exit code zero. A missing city is an outcome, not a crash."

---

## Shot 2 — the proof (0:35–1:05)

Switch to the browser. Click **Run pipeline**.

> "Same engine, streamed to a dashboard over server-sent events — the browser isn't
> re-implementing anything, it's subscribed to the same event bus the terminal renders from."

Let the waterfall draw, then tick **Overlay sequential**:

> "The grey bars are what this run would have looked like one at a time. That gap is the
> whole assignment."

Hover one of London's two bars:

> "Each attempt is separately timed — status code, latency, when it was dispatched."

---

## Shot 3 — the deliverable (1:05–1:25)

Scroll to the orders.json panel.

> "Before and after. Two orders changed status, and each delayed one carries the message the
> customer receives."

Then the terminal:

```bash
npm test
```

> "Forty-eight tests, no network. Including the one that matters: turn the concurrency limit
> down to one and the speedup collapses — so the concurrency assertions are measuring
> something real."

---

## Shot 4 — close (1:25–1:40)

```bash
npm run demo
```

> "And it runs with no API key at all — offline mode swaps in a fake `fetch`, so retry,
> backoff and parsing are still the real code path. Clone it and it works."

---

## If you have a spare 20 seconds

Open `.env`, show `OWM_API_KEY=`, and say: *"the key is read from `.env`, validated at boot,
and stripped from every log line and every frame sent to the browser."*

## Recovery, if the live API misbehaves on camera

- **401** — the key isn't activated yet (free-tier keys take ~10 min to a couple of hours).
  The run reports it as one clear message. Say that, and switch to `npm run demo`.
- **429** — you're over 60 calls/minute. Wait, or lower `MAX_CONCURRENCY`.
- **A city returns `Clear` when you wanted rain** — real weather doesn't take direction. Use
  `npm run demo`, whose fixtures are fixed at rain / clear / snow / 404.
