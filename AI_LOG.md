# AI Log

The assignment asks for the prompts behind the **parallel fetching** and **error handling**
logic. Those are the first two sections. I've included what the model got wrong alongside
what it got right, because the corrections are the part that actually shaped the code.

Tool used: Claude (Opus 5) via Claude Code.

---

## 1. Parallel fetching

**Prompt**

> I have a list of orders, each with a city. I need to fetch current weather for every city
> from OpenWeatherMap concurrently, not in a loop with await inside it. Node 22, TypeScript.
> Write the fan-out. One city in the list is invalid and will 404 — that must not stop the
> others.

**What came back:** a `Promise.all` over `orders.map(async (o) => fetch(...))` with a
`try/catch` inside the map callback returning `null` on failure.

**What I changed and why**

1. **`null` on failure throws away the diagnosis.** I replaced it with a
   `Result<WeatherSnapshot, WeatherError>` union ([src/result.ts](src/result.ts)) so a
   failed city carries its kind, HTTP status, and attempt count all the way to the report.
   The pipeline needs to say *why* order 1004 didn't resolve, and `null` can't.

2. **The follow-up I asked next was the useful one:**

   > Should this be `Promise.all` or `Promise.allSettled` given one city always fails?

   The model said `allSettled`. I went the other way, and this is the one design decision
   in the project I'd most want to defend in person: because each task is already wrapped to
   resolve to a `Result` rather than reject, `Promise.all` **cannot** short-circuit — there
   is nothing to reject. `allSettled` would work too, but it hands back `reason: unknown`
   and erases the per-attempt telemetry I need for the waterfall. `allSettled` is the right
   reflex when tasks can reject; the better fix is to stop them rejecting.

3. **I added the semaphore myself.** Unprompted `Promise.all` over `orders` opens one socket
   per order. Fine for four, not fine for ten thousand. [src/http/limiter.ts](src/http/limiter.ts)
   bounds it, and the same code path serves both sizes.

**Follow-up prompt**

> How do I *prove* in a test that these ran concurrently rather than sequentially?

This produced the approach in [tests/concurrency.test.ts](tests/concurrency.test.ts):
give every mock request identical latency, then assert on wall-clock versus the sum of
latencies. I added `maxOverlap` (a sweep over the attempt intervals) and `dispatchSpreadMs`
on top, because a wall-clock assertion alone passes on a fast machine for the wrong reasons.

---

## 2. Error handling

**Prompt**

> OpenWeatherMap returns 404 for an unknown city, 401 for a bad key, 429 when rate limited,
> and 5xx when it's having a bad day. Write retry logic. Which of these should actually be
> retried?

**What came back:** retry-with-exponential-backoff for everything except 404, correctly
identified. This was the model's strongest answer of the session — the 404/5xx distinction
came back unprompted with the right reasoning.

**What I changed and why**

1. **401 was in the retry set.** It shouldn't be — a rejected key is not going to be
   accepted on attempt two, and retrying it across every city turns one clear error into
   twelve confusing ones. I made `AuthError` *fatal*: it trips an `AbortController` that
   cancels the rest of the run and surfaces one actionable message
   ([src/errors.ts](src/errors.ts), [src/pipeline/run.ts](src/pipeline/run.ts)).

2. **Backoff had no jitter.** The first version was `base * 2 ** attempt`. With a fan-out,
   that means every retry from the same batch fires on the same tick and re-collides. Full
   jitter (`random() * ceiling`) fixed it.

3. **`Retry-After` was ignored.** When a server tells you exactly how long to wait, guessing
   is strictly worse. Added in [src/http/fetchWithRetry.ts](src/http/fetchWithRetry.ts).

4. **Nothing bounded a hung socket.** Backoff protects against a server that answers slowly;
   it does nothing about one that never answers. Every attempt now carries an
   `AbortController` deadline.

**Follow-up prompt**

> The 404 city should be logged and left alone, not silently dropped. What should its final
> record look like?

Settled on: status stays `Pending`, plus `needs_review: true` and an `error` block with the
kind, message, and attempt count. A delivery ops team can filter on that field; a dropped
row is invisible.

---

## 3. The weather-aware apology (the assignment's "AI Challenge")

**Prompt**

> Write a function that turns a customer name, a city, and an OpenWeatherMap condition +
> description into one warm sentence telling them their order is delayed. Match this shape:
> "Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your
> patience!"

**What came back:** a `switch` on the condition with one hardcoded sentence per branch
(`case 'Rain': return '...heavy rain...'`).

**What I changed and why**

The switch ignored the `description` field, so every rainy city got the words "heavy rain"
whether the API said `light rain` or `very heavy rain`. Reading the real description is what
makes the sentence true rather than merely plausible. The one transformation left is
dropping OpenWeatherMap's internal word "intensity" — `heavy intensity rain` is how the API
writes it and not how a person does. That's the whole of
[src/pipeline/apology.ts](src/pipeline/apology.ts)'s template tier.

I also read "use an AI tool to write the function" as having a stronger second reading —
call a model at runtime — so the module has both tiers: Claude when `ANTHROPIC_API_KEY` is
set, the template otherwise and whenever the model call fails, times out, or declines. The
template is the default, which keeps runs deterministic and offline-safe.

---

## 4. Where I didn't take the suggestion

Worth recording, since the interesting part of working with a model is the filtering.

- **Rejected: `zod` for config validation.** Suggested for `src/config.ts`. It's a dependency
  and a schema to parse six environment variables; twenty lines of hand-written parsing does
  the same job with a better error message.
- **Rejected: a `WeatherService` class with an injected `IWeatherProvider`.** One consumer,
  one implementation. A function returning a closure is the same thing without the ceremony.
- **Rejected: `Promise.allSettled`.** Covered above.
- **Rejected: retrying 401.** Covered above.
- **Rejected: a chart library for the waterfall.** Configuring one to draw a Gantt with
  segmented retry bars is more code than the ~60 lines of SVG in
  [web/src/components/Waterfall.tsx](web/src/components/Waterfall.tsx), and less control.
- **Corrected: a stale SDK version.** The first `package.json` pinned
  `@anthropic-ai/sdk@^0.68.0` from the model's memory. The published version was `0.124.0`,
  and `0.68` didn't have the `output_config` parameter the code used — it failed the
  typecheck immediately. Worth noting as a category: model recall of version numbers is not
  a source of truth, and the compiler caught it in one step.

---

## 5. Two bugs the self-review caught

Worth recording because both were in code that already passed its tests.

**The fatal-abort was dead code.** `AuthError` was documented as cancelling the rest of the
run, and the `AbortController` was wired through to every request — but the call to
`abort()` sat in the loop that processes results, which runs *after* `await Promise.all(...)`.
By then every request has already settled, so the signal cancelled nothing. Moved into the
task itself, and the regression test asserts against a 3-second fetch that the run finishes
in under one, which can only pass if the cancellation is real.

**The semaphore could run at twice its limit.** The first version decremented `active` and
then woke a waiter, leaving a microtask-sized window where a new caller sees a free slot that
is already spoken for. My first attempt to reproduce it *failed* — the test crossed a
macrotask boundary, which lets every queued waiter resume first, so peak stayed at 2. Only
after injecting callers across forty microtask depths did it show: peak 4 at a limit of 2, 6
at 3, 2 at 1. Handing the permit straight to the waiter closes the window. The lesson is the
one about the first test: a passing concurrency test is weak evidence unless you have watched
it fail.

---

## 6. What was written without a model

The waterfall's overlap sweep, the sequential-ghost overlay, the decision to make offline
mode a fake `fetch` rather than a fake client (so the mock exercises the real retry and
parsing code), the event-bus design that lets the CLI and the dashboard be two views of one
run, and the atomic file write. These are the parts I'd point at first in a review.
