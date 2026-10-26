# Kindling

Where strangers become regulars.

Kindling is an AI agent that turns a venue's empty weeknight into a recurring club for people with shared taste, using the Qloo taste API.

Repo: https://github.com/sahil-makandar/kindling

Work in progress for the Qloo Agentic Hackathon. The full README (setup, architecture, Qloo endpoints, limits) comes at the end of the build.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL; keep QLOO_MODE=fixtures and LLM_MODE=mock
npm run dev                  # http://localhost:3000
npm run typecheck && npm test
```

Needs Node 20.9 or newer.

## Licence

MIT. See `LICENSE`.
