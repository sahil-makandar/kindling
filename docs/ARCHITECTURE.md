# Architecture

How Kindling works, written for someone who wants to read the code.

## The shape of it

Next.js (App Router) with Postgres (Drizzle) behind it. Route handlers are thin. The logic lives in `src/` as plain functions that tests can call without HTTP.

```
app/        pages and API route handlers
src/
  agent/    the run pipeline: locator, scout, designer, verifier, producer, baseline, llm layer, prompts
  qloo/     the only code that talks to Qloo: client, endpoints, schemas, tags, offline fixtures
  scoring/  the club score (pure)
  seating/  taste vectors and table assignment (pure)
  coach/    signals, decision rules, recommendations, weekly view
  checkin/  clubs/  runs/  progress/  the logic behind the routes
  db/       schema and client
  ui/       components
```

## A run is a small state machine

`POST /api/runs` creates a venue and a run. The page then calls `POST /api/runs/[id]/advance` over and over. Each call claims the next stage in the database, runs it, and returns, so no request does more than one stage (`maxDuration` is 60 seconds). Stages are `locate`, `scout`, `design`, `verify` and `baseline`. At the same time the page polls `GET /api/runs/[id]?after=<cursor>` for new trace lines, which the stages write as they work.

If a stage fails, a plain message goes into the trace and the run keeps whatever it has. Scout and Design are critical, the others are skipped. A stage that never finishes can be claimed again after 90 seconds. Refreshing the page picks a run up where it is.

The comparison without Qloo runs next to Verify, since it only needs the venue and the finished pool. Its answer is cached for the run, so the baseline stage that follows finds it ready.

A venue that was read in the last 24 hours (same name, spot, kind, night and Qloo mode) reuses the saved run instead of spending Qloo calls. Reused runs do not count against the per-IP limit, which lives in Postgres.

## The agents

- **Locator** (code). Searches Qloo for the venue by name. A match must pass a name-similarity check and a category check, because a made-up name returns look-alikes. If nothing matches, the run reads the neighbourhood anyway.
- **Scout** (model tool loop, with a standard plan as fallback). The model picks tools: scan an area in one domain, read the area's tags, find venues like this one, read what is rising, look at nearby places, widen the radius, finish. It gets a budget of Qloo calls and a reason is required for every call. Anything it does not do, the standard plan fills in. Independent scans go out together, and the Qloo client still spaces the requests. Everything it learns goes into a signal pool.
- **Designer** (model, checked by code). Sees short aliases (m1, a3) for the pool, never Qloo ids, and proposes 6 to 8 clubs. Code resolves the aliases and drops any club that cites something not in the pool, uses a place as an anchor, or repeats an anchor. Cold names ("Live Sound Session") are replaced with a plain one.
- **Verifier** (code and Qloo). Scores every club with the formula below and, for the best few, asks Qloo whether the companions really go with the anchor.
- **Producer** (model, checked by code). Writes the kit. The playlist is picked by code from the pool, and a licence note is added whenever a text mentions screening a film.
- **Seater** (code). See below.
- **Coach** (code decides, model words it). See below.
- **Baseline** (model). The same question with no Qloo data, scored against the pool.

## The club score

A fixed formula from 0 to 100, with a reason and the Qloo calls behind every part:

| Part | Weight | Reaches |
|---|---|---|
| Venue's crowd | 0.20 | Overlap between the club's tags and the tags of the venue and venues like it |
| Places within 1 km | 0.15 | Overlap with the nearby places' tags, plus whether the club uses one of them |
| City's culture | 0.15 | The anchor's rank among what the city loves |
| Fits together | 0.15 | Qloo's affinity of the companions for fans of the anchor |
| Right kind of night | 0.15 | A rule: how well the format suits the venue type |
| Rising now | 0.10 | The anchor's rank among what is trending |
| Known but not too common | 0.10 | Popularity percentile, best around the 60th |

If the venue is not on Qloo, places of the same kind nearby stand in for its crowd, and the page says so.

## Seating

A guest's taste is a weighted list of tags, read from their three favourites with one `/entities` call (cached by favourite set). Similarity is 0.75 weighted Jaccard plus 0.25 for a shared favourite. Tables are built with farthest-first seeds, then people are placed most-constrained first, then up to 200 swaps improve the total similarity. Nobody sits alone, and a table does not fill up with regulars. A latecomer is placed at the best table with room. Check-in runs under a per-session advisory lock, so two phones cannot take the same seat. The explanation shown to a table ("You all love...") only claims what every member really has.

## The Coach

From the sessions it computes the attendance trend, the return rate of the last night, how many nights in a row attendance fell, drift (1 minus the cosine similarity of the room's taste and the club's theme) and regulars made (three or more visits). The decision is a few rules, in this order:

1. Two falling nights and a return rate under 20%: switch.
2. Drift above 0.65 while attendance holds: tweak, even if the club is doing well.
3. Attendance steady or growing and a return rate of 30% or more: keep.
4. Attendance slipping: tweak.
5. Otherwise: keep.

The model only writes the variant and the wording. If its reason does not quote the real numbers, code replaces it.

## Qloo, and what we learned

Calls are listed in the README. A few things shaped the design:

- Film, music, TV, book and podcast taste is city-wide. Two neighbourhoods in one city return nearly the same lists. Places are the local signal, so the score weighs them and the venue's own tags more than the city.
- A place cannot be the taste signal for films or music (the API answers 400). The venue's crowd is therefore read from tags, not from media.
- Affinity for an area's top results is almost always above 0.99, so it cannot rank anything. Position in the list and a rescale within the list are used instead, and `filter.results.entities` with an anchor gives spread values for the coherence check.
- A popularity cap on the scan brings out the more distinctive picks.
- The tag insight for a set of favourites returns genre mixed with place and price tags, so guests' tags come from the favourites' own tags instead.
- Books do not support trends and video games are not supported at all.
- Invalid parameters are ignored without an error. Empty results are debugged from the full parameter set, which is kept in the call log.

## The language model layer

`src/agent/llm.ts` is the only code that talks to a model. A chain of providers (Gemini, then OpenRouter) is tried in order, each provider's quicker model before the next provider, with retries on rate limits. A provider that rejects its key is skipped. Every answer is checked against a Zod schema and cached per run, and every caller supplies a deterministic fallback, so a busy free tier never breaks a run. Model names come from the environment. Nothing personal goes to a model.

## Data and privacy

Tables: venues, runs, trace events, Qloo calls, signals, candidates, baselines, clubs, sessions, attendees, check-ins, recommendations, plus caches for Qloo, geocoding and LLM output, and a rate-limit table. Attendees are a nickname and a random device token (only if they tick the box). "Forget me" deletes the attendee and their check-ins. Simulated rows are flagged `simulated` and labelled on screen.

## Testing

Vitest, no network and no database. The Qloo client, schemas, scout loop, designer rules, score, seating, coach rules, check-in and rate limits each have their own tests. A copy lint checks the writing rules (no dashes, no banned words). `scripts/layout-check.ts` runs against a running app and checks overflow, clipped text, tap targets and accessibility at four widths.
