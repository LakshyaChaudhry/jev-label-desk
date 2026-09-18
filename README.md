# Jev Label Desk

Weekend demo: upload a CSV or JSONL, define a TypeSafe **Jev** rubric, batch-label every row through the [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), export a labeled CSV.

No auth. Local / dev first. The OpenRouter key stays on the server.

## Setup

```bash
cp .env.example .env
# paste your key
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`.env` is gitignored. Never commit a real key.

```
OPENROUTER_API_KEY=
JEV_MOCK=0
```

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Server-side key from [openrouter.ai/keys](https://openrouter.ai/keys) |
| `JEV_MOCK` | `1` / `true` — skip live calls, return deterministic labels |
| `JEV_MODEL` | Default `~typesafe/jev-latest` |
| `JEV_FALLBACK_MODEL` | Default `typesafe/jev-1.13` |
| `JEV_CONCURRENCY` | Parallel row workers (default `4`) |

Without a key, set `JEV_MOCK=1` so the happy path still runs.

## Happy path

1. Click **Load sample CSV** (or upload `fixtures/support-tickets.csv` / `.jsonl`).
2. Keep `subject` + `message` as the item text / context.
3. Leave the default **choice** rubric (billing / technical / sales / other), or switch to **noul** / **score**.
4. **Batch label**. Watch progress. Failed rows are marked; the batch continues.
5. **Export labeled CSV** — original columns plus `label`, `confidence`, `label_detail`, `model`, `error`.

## Label modes

These map to Jev’s Decisions primitives ([TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)):

| Mode | What you define | What comes back |
| --- | --- | --- |
| **noul** | Yes/no question + optional true/false criteria | `true` / `false` from P(yes); detail keeps the raw `noul` |
| **choice** | Fixed option ids + descriptions | Winning option + probability blob |
| **score** | Integer min/max (2–10 levels) + optional labels | Weighted score mapped onto your scale |

Jev does not generate free-text rationales. Confidence / probability is what the model returns.

## API shape

Server-only `POST https://openrouter.ai/api/alpha/decisions`:

```json
{
  "model": "~typesafe/jev-latest",
  "state": { "subject": "…", "message": "…" },
  "questions": {
    "label": {
      "type": "choice",
      "instructions": "Which team should handle this support ticket?",
      "criteria": {
        "billing": "Charges, invoices, refunds",
        "technical": "Bugs, outages, login",
        "sales": "Pricing, plans, upgrades",
        "other": "Anything else"
      }
    }
  },
  "provider": { "allow_fallbacks": true }
}
```

If `~typesafe/jev-latest` fails transiently, the desk retries and then falls back to `typesafe/jev-1.13`. 4xx validation errors fail that row only.

## Scripts

```bash
npm run dev      # Next.js
npm run lint     # tsc --noEmit
npm test         # parser + criteria unit tests
npm run build
```

## Layout

```
fixtures/                 sample tickets (CSV + JSONL)
src/app/api/label         streaming NDJSON batch
src/app/api/health        mock / key / model status
src/lib/decisions.ts      OpenRouter client, retry, fallback
src/components/Desk.tsx   four-step UI
```
