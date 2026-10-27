# Deploying Kindling

Live site: https://kindling-sand-eight.vercel.app/

Kindling deploys to Vercel from the `main` branch of https://github.com/sahil-makandar/kindling. Every push to `main` builds and deploys by itself.

## Environment variables

Set these in Vercel under Project, Settings, Environment Variables, for the Production environment.

| Variable | Value | Notes |
|---|---|---|
| `QLOO_MODE` | `live` | Required. The deployed site must use the real Qloo API. |
| `QLOO_API_KEY` | your hackathon key | Secret. Never commit it. |
| `LLM_MODE` | `live` | |
| `LLM_PROVIDER` | `google` | Main provider. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | your AI Studio key | Secret. |
| `LLM_MODEL`, `LLM_MODEL_FAST` | current free Gemini models | Copy from `.env.example`. |
| `LLM_THINKING_MAIN`, `LLM_THINKING_FAST` | `minimal` | Keeps answers quick. |
| `LLM_FALLBACK_PROVIDERS` | `openai-compatible` | OpenRouter, tried when Gemini is busy. Groq is not in the default chain. |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL`, `OPENAI_COMPATIBLE_MODEL_FAST` | OpenRouter values | Optional but recommended. |
| `DATABASE_URL` | Neon pooled connection string | Secret. All migrations must be applied. |
| `APP_URL` | `https://kindling-sand-eight.vercel.app` | Used for QR code links. |
| `NOMINATIM_USER_AGENT` | `Kindling/1.0 (https://github.com/sahil-makandar/kindling)` | Required by the Nominatim usage policy. |
| `RATE_LIMIT_PER_HOUR` | `10` | Agent runs per visitor per hour. |

## Region

The database is on Neon in `us-east-2` (Ohio). Put the Vercel functions next to it: Project, Settings, Functions, Function Region, choose `cle1` (Cleveland) or `iad1` (Washington DC). The default region can be on the other side of the country, and every page makes several database round trips, so a matching region is the single biggest speed gain.

## Database

```bash
npm run db:migrate                                  # apply every migration in drizzle/
QLOO_MODE=live npm run db:seed-demo -- --force      # rebuild the sample venue (The Lantern Room, fictional)
```

Both commands read `DATABASE_URL` from `.env.local`. The sample venue is built by a real agent run, so the seed needs live Qloo and a live model key, and takes a few minutes.

## Smoke test after every deploy

1. Open https://kindling-sand-eight.vercel.app/ . There is no sample-data banner.
2. Press "Explore a sample venue". The weekly report opens with "Simulated weeks" labelled and a Coach decision with numbers.
3. Press "Start with your venue", pick an example venue and press "Find my hidden clubs". The run takes about a minute. Club cards appear, each with scores labelled "your venue's crowd", "places within 1 km" and "your city's culture".
4. Press "Make the top pick our club". The kit opens with a poster. Press "Print the poster" and check it fits one A4 page.
5. Press "Run the night", scan the QR code on a phone, check in with three favourites and see the table.
6. Open https://kindling-sand-eight.vercel.app/venues . The venue you just made is listed.
7. Open https://kindling-sand-eight.vercel.app/how . The Qloo call counts are not zero.

## If something is wrong

- A page says "wording came from a template": the language model was busy. The numbers are unaffected. Try again in a minute.
- Runs fail at once: check `QLOO_API_KEY` and that `QLOO_MODE` is `live`.
- Every page errors: check `DATABASE_URL` and that `npm run db:migrate` has run against that database.
