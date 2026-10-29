# Kindling

Kindling is an agent that turns strangers into regulars.

A cafe, bar or bookstore gives it an address and its slowest night. Kindling reads what the city and the places around that venue love, designs a weekly club around it, and writes the kit to run it. On the night it seats each guest with people who share their taste, then looks at who came back and changes next week's plan.

- Live site: https://kindling-sand-eight.vercel.app/
- Source: https://github.com/sahil-makandar/kindling
- Licence: MIT

## The moment it is built for

A guest scans the QR code on the poster, types a first name and taps three things they love. A few seconds later their phone says:

> You're at table 2. You all love: Wong Kar-Wai, city pop, Intimate.
> With you: Ada, Bo.

Nobody filled in a form about their personality. Qloo knows what those three favourites have in common with the three favourites of the person at the next seat, and the seating code does the rest.

## The weekly loop

One night does not make a friend. Friendships take about 50 hours together, so the club has to repeat. After each night the Coach reads the numbers and says **keep**, **tweak** or **switch**, with the figures in the reason. For example:

> Tweak it. Check-ins went 9, 13, 16, 21 and 48% of the last night had been before, but the room's taste has drifted from the club's theme (drift 0.93). Keep what works and lean towards what the room loves.

The weekly page counts **regulars made**: people who have come three or more times. That is the number a venue owner should care about.

The sample venue on the site (The Lantern Room, fictional) has four simulated weeks so you can see this without waiting a month. Every page that shows simulated data says so.

## What each step does

1. **Scout.** A model-driven tool loop that chooses which Qloo scans to run: what the city loves in film, music, TV, books and podcasts, what is rising, the places within 1 km, and venues like yours.
2. **Design.** Proposes 6 to 8 clubs. Everything a club cites must exist in the Scout's results, and code drops anything that does not.
3. **Verify.** Scores each club with a fixed formula and checks the best ones with more Qloo calls. Each part of the score says how far it reaches (your venue's crowd, places within 1 km, your city's culture) and links to the exact calls behind it.
4. **Produce.** Poster with a check-in QR code, run of show, listing copy, playlist, menu special, trivia and a table tent.
5. **Run the night.** Check-in, taste-based seating, a live view for the host.
6. **Coach.** Keep, tweak or switch for next week.

Every run also shows a "Without Qloo" panel: the same question put to a plain language model, so you can compare.

## Qloo calls

All calls go through `src/qloo/client.ts`: GET only, a path allow-list, 340 ms between requests, one retry on 429, a 15 second timeout, a Postgres cache, and a log of every call that powers the "How we know" drawers.

| Step | Endpoint | What it asks | Why |
|---|---|---|---|
| Locate | `/search` | The venue by name | Its own tags |
| Scout | `/v2/insights` (film, music, TV, books, podcasts) | Taste around the address, once for the biggest names and once with a popularity cap | What the city loves |
| Scout | `/v2/insights` (tags) | Tags around the address | The vocabulary of the area |
| Scout | `/v2/insights` (places) | Places within 1 km | The most local signal |
| Scout | `/v2/insights` (places) | Places like the venue | The venue's crowd |
| Scout | `/v2/insights` with `bias.trends` | What is rising | The momentum part of the score |
| Verify | `/v2/insights` with `filter.results.entities` | The anchor as the signal, the companions as the list | Whether a club fits together |
| Verify | `/v2/insights` (heatmap) | The best club's anchor | Where its taste is strongest, for the map |
| Check-in | `/search` | A favourite by name | Autocomplete |
| Check-in | `/entities` | The three favourites by id | A guest's taste vector |
| Coach | `/entities` | The club's theme by id | How far the room has drifted |
| Coach | `/v2/insights` | Entities near the venue, starting from what the room loves | Next week's fresh angle |

Qloo's film, music, TV, book and podcast taste is city-wide, so it is the same for every venue in a city. What makes a club fit a venue is the places around it and the venue's own tags, and the score weighs those more. `docs/ARCHITECTURE.md` has the details and what we learned about the API.

No Qloo response data is stored in this repository. `fixtures/sample/` holds hand-written sample data whose ids all start with `fx_`.

## Run it locally

Needs Node 20.9 or newer and a Postgres database (a free Neon project works).

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL
npm run db:migrate
npm run dev                    # http://localhost:3000
```

The defaults (`QLOO_MODE=fixtures`, `LLM_MODE=mock`) need no API keys. The app shows a banner whenever it runs on sample data.

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | Always | Postgres connection string |
| `QLOO_MODE` | Always | `fixtures` (offline), `live` (real API), `record` (live, and saves raw responses to the git-ignored `fixtures/live/`, local only) |
| `QLOO_API_KEY`, `QLOO_BASE_URL` | `live`, `record` | The key only works on `https://hackathon.api.qloo.com` |
| `LLM_MODE` | Always | `mock` (canned answers) or `live` |
| `LLM_PROVIDER`, `LLM_FALLBACK_PROVIDERS`, `LLM_MODEL`, `LLM_MODEL_FAST` | `live` | `google` or `openai-compatible`; model names come from the environment, never the code |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPATIBLE_*` | `live` | Only the providers you use |
| `RATE_LIMIT_PER_HOUR` | Optional | New runs per IP per hour, default 30. Reused runs never count |
| `NOMINATIM_USER_AGENT` | Optional | Identifies the app to Nominatim |

```bash
npm run check          # typecheck, eslint, copy lint, tests
npm run build          # production build
npm run db:seed-demo   # builds the fictional sample venue with four simulated weeks
npm run qloo:spike     # live probe of the Qloo API; raw responses stay on your machine
```

`QLOO_MODE=live npm run db:seed-demo -- --force` rebuilds the sample venue from a real agent run. Deployment notes are in `docs/DEPLOYMENT.md`.

## Tests

`npm test` runs about 600 Vitest tests with no network and no database. They cover the Qloo client, the response schemas, the Scout loop and its budget, the Designer's grounding rules, the club score, the seating, the Coach's decision rules, the check-in flow, rate limits and the copy rules.

## Privacy and honesty

- Guests give a first name or nickname. No email, no phone number.
- Qloo receives only entity ids, tag ids and coordinates. A guest's name never leaves our database.
- The language model receives only numbers and tag names for a whole room, never a name or one person's picks.
- A cookie recognises a returning guest only after they tick a box. It holds a random code.
- "Forget me" on the check-in confirmation deletes the guest and every check-in linked to them.
- Trivia is written by a language model and marked "Check before use".
- When no model answers, the page says the wording came from a template. Scores, seating and decisions are computed by code either way.

## Limits

- Coverage outside the US depends on Qloo's data for that city.
- The free language model tiers are sometimes busy, so wording can fall back to templates.
- Session dates are UTC calendar dates, so a venue far from UTC may see the date shift by a day.
- Showing a whole film in public needs a licence. The kit never plans a screening.

## Licence

MIT. See `LICENSE`.
