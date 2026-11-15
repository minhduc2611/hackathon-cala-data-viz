# CalaViz

Reusable, notebook-style reports on [Cala](https://cala.ai)'s knowledge graph of companies, people, funding rounds and investors.

A **template** is a Cala query with `{{parameters}}` followed by a path of cells: filter, split, aggregate, chart, graph, check, AI note. Change a parameter (say `industry = fintech` → `climate`) and the whole path re-runs on fresh, sourced data. Save it once, then share it as a report anyone can replay with their own values.

Built at Junction 2026 for the Cala challenge: help founders and investors read a market from reliable public data.

## What it does

- **Notebook editor.** Each cell works on the rows of the cell above and shows its own table, chart or graph.
  - **Main query:** a Cala dot-notation query, with autocomplete that suggests entities, their properties and related entities from Cala's schema.
  - **Row cells:** filter, split (a list cell such as `investors` into one row each), aggregate, sort.
  - **Extra sources:** a further `query` cell starts a second data source, and `join` combines two.
  - **Views:** a bar or line chart, and a company ↔ investor graph. Click an edge to see the rows behind it.
  - **Checks and notes:** a `check` compares a claim with the data. An **AI note** writes STORY / WHO BENEFITS FROM THIS / WHAT IT MEANS / TRUST from the cells above, and rewrites itself when their data changes.
- **Reports.** `run report` saves the template and opens a clean report page with the parameters on top. Click a bar or label to cross-filter every later section; shift or cmd selects several.
- **Cala AI chat.** A Claude agent that reads the analysis, writes Cala queries and adds, fixes or deletes cells for you. Ask it to "build a report on X".
  - It works in rounds: plan the sections, check each query, add cells, read the result, fix errors, and finish with an AI note.
  - It uses Cala's own agent guide ([skills/cala/SKILL.md](skills/cala/SKILL.md)) as a tool.
  - Its steps stream into the chat as they happen.
  - A run keeps going on the server if the page reloads or the connection drops; reopening the template follows it again.
- **Caching.** Every Cala call is cached in MongoDB, keyed by a hash of the request, so a repeated query costs no credits and returns instantly. The browser also keeps recent results so pages show at once.

### Included templates

ai-smart-money, co-investor-network, ai-lab-alumni, acquirer-playbook, funding-pulse, next-check, founder-claim-check, investor-graph, two-industries and fintech-by-location. Each covers a question investors or founders ask, such as who leads rounds in a sector, who co-invests with whom, or whether a founder's claims hold up.

## Run it locally

Needs Node 22+ and a MongoDB database (Atlas works).

```sh
npm install
cp .env.example .env    # then fill it in, see below
npm run dev             # API on :5055, Vite dev server on http://localhost:5173
```

For a production-style run, `npm run build && npm start` serves the API and the built app together on http://localhost:5055.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_CONNECTION_STRING` | yes | Stores the templates and the Cala cache |
| `MONGODB_DB` | no | Database name, if not the default |
| `CALA_API_KEY` | yes | Cala API key. Locally it falls back to `../cala-data/.env` |
| `ANTHROPIC_API_KEY` | no | Turns on Cala AI chat and AI notes |
| `PORT` | no | Defaults to 5055; the Docker image uses 8080 |

On first start with an empty `templates` collection, the server loads `saved/*.json`. Those files are gitignored, so a fresh deploy starts from whatever is in the database.

### Deploy

The `Dockerfile` builds the app and runs it on port 8080. Set the variables above on the host, and allow the host's outbound IPs in MongoDB Atlas Network Access. `GET /api/health` shows which database the deploy reads, with its template and cache counts.

## Project layout

| Path | What's there |
|---|---|
| [server/index.ts](server/index.ts) | HTTP API; also serves the built app from `dist/` |
| [server/engine.ts](server/engine.ts) | Runs a template: parameters, every cell type, cross-filter selection |
| [server/cala.ts](server/cala.ts) | Cala MCP client with the MongoDB cache |
| [server/schema.ts](server/schema.ts) | Learns Cala's entity types and relations for autocomplete |
| [server/agent.ts](server/agent.ts) | Cala AI: the Claude tool loop, AI notes |
| [server/store.ts](server/store.ts), [server/db.ts](server/db.ts) | Template storage in MongoDB |
| [web/src/](web/src/) | React app: editor (`Analysis.tsx`), report (`Report.tsx`), chat (`Chat.tsx`), charts and graph |
| [shared/](shared/) | Types shared by the server and the app |
| [skills/cala/](skills/cala/) | Cala's agent skill, copied from cala-ai/cala-skill v1.1.1 |

## Tests

```sh
npm test         # engine and chat-markdown tests
npm run build    # type check and production build
```

## Limits

- A new Cala query takes 15–60 seconds; cached ones are instant. **Refresh data** on a template fetches its queries again.
- Cala returns some values as prose ("~$9.4B raised"). Number parsing handles K/M/B, words and ranges, but check a column before you trust a sum.
- Chat history is kept in server memory, so a server restart starts a fresh conversation.
- A Cala AI run cannot be stopped from the page; it ends when the report is done or after 40 rounds.
