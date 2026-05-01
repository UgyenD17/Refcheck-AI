# RefCheck AI

> BorderHack '26 — Track 02 Sponsored Bounty  
> AI-powered sports officiating analysis tool

## How it works

```
Upload Clip → Gemini 2.0 Flash (reads video) → Claude Sonnet (rules on play) → Verdict
```

1. **Gemini 2.0 Flash** receives the raw video and produces a neutral, objective description of what happened
2. **Claude Sonnet** receives that description + the embedded sport rulebook and returns a structured verdict: `Fair Call`, `Bad Call`, or `Inconclusive`

## Setup

### 1. Install dependencies
```bash
pnpm install
```

### 2. Configure API keys
```bash
cp .env.example .env
```

Fill in your `.env`:
```
VITE_GEMINI_API_KEY=your_gemini_key     # https://aistudio.google.com/app/apikey
ANTHROPIC_API_KEY=your_anthropic_key   # https://console.anthropic.com
```

> **Note:** The Anthropic key is kept server-side. The Vite dev server proxies
> `/api/anthropic` → `api.anthropic.com` and injects the key automatically,
> so it is never exposed in the browser bundle.

### 3. Run
```bash
pnpm dev
```

## Demo mode

Don't have API keys handy? Select a **demo clip** from the dropdown — the app
returns pre-baked analysis results instantly without any API calls.

## Sports supported

| Sport | Rules embedded |
|-------|---------------|
| Soccer | FIFA Laws of the Game (Law 11, 12, 14) |
| Basketball | NBA Rulebook (Rule 10, 12) |
| American Football | NFL Rulebook (PI, Holding, Roughing, Offsides) |

## Production deployment

For production, replace the Vite proxy with a proper backend endpoint that:
1. Accepts the play description from the frontend
2. Calls `api.anthropic.com` server-side with your `ANTHROPIC_API_KEY`
3. Returns the Claude response

Set `VITE_CLAUDE_ENDPOINT=https://your-backend.com/api/analyze` in production env.
