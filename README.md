# RefCheck AI

RefCheck AI is a demo-ready RAG app for reviewing sports officiating calls against official rules. The current soccer implementation ingests all 17 IFAB Laws of the Game for 2025/26.

## What is included

- Soccer rule ingestion for all 17 official IFAB Laws.
- Local JSON rule chunk storage at `data/rules/soccer/ifab-laws-chunks.json`.
- Keyword retrieval over rule chunks with metadata: `sport`, `law_number`, `law_title`, `section`, `text`, and `source`.
- Backend endpoint: `POST /api/analyze-call`.
- Clip review endpoint: `POST /api/analyze-clip`.
- Simple frontend form for uploading a clip, entering the original call, and creating a report.
- OpenAI model support when `OPENAI_API_KEY` is set, plus a deterministic rule-grounded local fallback for demos.

## Setup

```bash
npm run ingest:soccer
npm start
```

Open `http://localhost:3000`.

The app has no runtime npm dependencies. It expects Node 20 or newer.

## Optional AI configuration

Set an API key to have the backend send the retrieved rules, reviewer notes, and sampled video frames to an OpenAI vision-capable model:

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="gpt-4.1-mini"
npm start
```

By default, if the AI call fails or no API key is present, the app uses reviewer notes with a deterministic local fallback grounded in the retrieved rule chunks. If the user uploads only a clip and provides no notes, the app returns `Inconclusive` unless a working AI vision model is configured. To require model responses and return an error when the AI call fails:

```bash
export REFCHECK_STRICT_AI=true
```

## Ingesting Soccer Rules

The ingestion script fetches the official IFAB Laws pages:

`https://www.theifab.com/laws/latest/`

Generate the retrievable chunk store:

```bash
npm run ingest:soccer
```

Check that the backend can see the chunks:

```bash
curl http://localhost:3000/api/rules/soccer/status
```

## Test the RAG Endpoint

```bash
curl -X POST http://localhost:3000/api/analyze-call \
  -H "Content-Type: application/json" \
  -d '{
    "sport": "soccer",
    "original_call": "Foul",
    "play_description": "Defender trips the attacker from behind while challenging for the ball."
  }'
```

## Test the Clip Report Endpoint

The browser upload flow samples still frames from the clip and sends those frames to the backend. With `OPENAI_API_KEY` set, the model inspects the sampled frames, compares the visible play to retrieved IFAB Laws chunks, and saves a report in `data/reports/`.

You can also test the report endpoint with reviewer notes:

```bash
curl -X POST http://localhost:3000/api/analyze-clip \
  -H "Content-Type: application/json" \
  -d '{
    "sport": "soccer",
    "original_call": "Foul",
    "play_description": "Defender trips the attacker from behind while challenging for the ball.",
    "clip": {
      "name": "sample.mp4",
      "type": "video/mp4",
      "size": 1024
    },
    "frame_data_urls": []
  }'
```

The response includes a report id:

```json
{
  "id": "report-...",
  "type": "clip_review",
  "analysis": {
    "verdict": "Fair Call",
    "confidence": "Medium"
  }
}
```

Fetch a saved report:

```bash
curl http://localhost:3000/api/reports/report-id-from-response
```

Expected demo shape:

```json
{
  "verdict": "Fair Call",
  "confidence": "Medium",
  "reasoning": "The retrieved Law 12 direct free kick rule supports a foul call because tripping an opponent is listed as a direct free kick offence.",
  "relevant_rules": [
    {
      "law_number": "12",
      "law_title": "Fouls and Misconduct",
      "section": "12.1 Direct free kick"
    }
  ]
}
```

## Run Tests

```bash
npm test
```

## Expanding Later

To add other sports, create an ingestion script to emit chunks under `data/rules/<sport>/`, then register the generated rule file in `src/rag/ruleStore.js`.
