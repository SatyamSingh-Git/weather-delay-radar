# Demo recording — shot list

Target: **2 minutes**. Record at 1920×1080, browser zoom 100%, terminal font ~18pt.

The arc is deliberate: **live API first** to prove the integration is real, **fixtures second**
to show the delayed path, because real weather won't cooperate on demand.

**"The waterfall"** is the bar chart — the `─ Concurrency ─` block in the terminal, and the
panel headed *Concurrency waterfall* in the dashboard. Same chart shape as your browser
DevTools' Network tab: one horizontal bar per request on a shared time axis.

```
New York     ███████████████████████                      420.5ms 200
Mumbai       ████████████████████████████████             591.1ms 200
London       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          █████████████████ 823.1ms 503→200
InvalidCity… ▓▓▓▓▓▓▓                                      125.7ms 404
```

Left-to-right is time from the start of the run. Every bar starting at the same left edge is
the concurrency, visible: sequential code would draw a staircase instead. `█` is a successful
attempt, `▓` a failed one — London's two segments are its 503 and its retry, and the space
between them is the backoff wait.

## Before you hit record

```bash
npm install && npm run build:web
```

Two terminals:

- **Terminal A** — `npm run dev`, left running. Browser tab already open on
  <http://localhost:5173>. This is plumbing, not story; it should never appear on camera.
- **Terminal B** — the one you film. Run `npm run demo` once as a dry run, then `cls` to
  clear. That warms Node's cache so the take doesn't open with dead air.

Check the key is live before you start — `npm start` should return real temperatures, not a
401. Turn on Do Not Disturb.

`npm start` writes `data/orders.processed.json`; `npm run demo` writes
`data/orders.delayed-example.json`. They don't overwrite each other, so run either freely.

---

## Shot 1 — against the real API (0:00–0:30)

```bash
npm start
```

> "Four orders, four cities, and the script fetches weather for all of them concurrently.
> This is the live OpenWeatherMap API — real temperatures, timestamped a few seconds ago."

When the `─ Concurrency ─` block prints (the bar chart):

> "Peak overlap four: four requests genuinely in flight at once, not a fast loop. Wall clock
> is about 450 milliseconds against 880 sequential."

Then the `─ Orders ─` block:

> "Today New York, Mumbai and London are all clear or cloudy, so nothing is delayed — that's
> the honest output, real weather doesn't take direction. What does happen is InvalidCity123
> comes back 404. It's logged, tagged for review, and the run still exits zero. A missing city
> is a reported outcome, not a crash."

*If a city happens to be raining when you record, even better — say so and you can shorten
Shot 2.*

---

## Shot 2 — the delayed path (0:30–1:00)

```bash
npm run demo
```

> "To show the delay logic on demand, the same pipeline runs against deterministic fixtures.
> Offline mode replaces `fetch` and nothing above it — retry, backoff, status handling and
> parsing are all the same code you just watched hit the live API."

Point at the `+ 1ms → New York` dispatch lines at the top:

> "All four dispatched within about a millisecond. London's first attempt returns 503, so it
> backs off and retries — that's the gap and the second segment on its bar."

Then the `─ Orders ─` block:

> "New York is raining and London is snowing, so both flip to Delayed, and each customer gets
> a message built from the actual forecast — 'heavy rain' for one, 'light snow' for the other.
> Mumbai is clear and stays Pending."

---

## Shot 3 — the proof (1:00–1:35)

Switch to the browser. Click **Run pipeline**.

> "Same engine, streamed to a dashboard over server-sent events. The browser isn't
> re-implementing anything — it subscribes to the same event bus the terminal renders from."

Let the waterfall draw, then tick **Overlay sequential**:

> "The grey bars are what this exact run would have looked like one at a time. That gap is the
> whole assignment."

Hover one of London's two bars:

> "Every attempt is separately timed — status code, latency, dispatch and settle."

Scroll to the orders.json panel:

> "Before and after. Two orders changed status, and each one carries the message the customer
> receives."

---

## Shot 4 — close (1:35–2:00)

```bash
npm test
```

> "Forty-eight tests, no network. Including the one that matters: turn the concurrency limit
> down to one and the speedup collapses — so the concurrency assertions are measuring
> something real rather than passing because the machine is fast."

Optional, if you have the seconds — open `.env`:

> "The key lives in `.env`, is validated at boot, and is stripped from every log line and
> every frame sent to the browser. And the whole thing runs with no key at all against the
> fixtures, so you can clone it and it works."

---

## Numbers that move, and numbers that don't

Don't commit to a speedup figure in narration — jitter changes the backoff wait, so it ranges
about **2.1× to 2.9×** offline. Say "roughly two and a half times" or read what's on screen.

The stable evidence is **peak overlap 4** and, offline, a **~1ms dispatch spread**. Those don't
drift.

On the live run the dispatch spread is larger — tens of milliseconds — because the first
request to a new host pays DNS and TLS before the connection pool is warm. Peak overlap still
reaches 4, so the fan-out is unaffected. If you quote a dispatch spread, quote the offline one
and say it's offline.

---

## If something misbehaves on camera

- **401** — the key was deactivated or swapped. The run says so in one line and exits 1. Cut
  to `npm run demo`, which needs no key.
- **429** — over 60 calls/minute on the free tier. Wait a minute, or lower `MAX_CONCURRENCY`.
- **A city you expected to be wet is clear** — that's Shot 2's entire reason for existing.
