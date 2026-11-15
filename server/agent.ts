// Claude agent for one template: reads the analysis, runs Cala, and edits cells through tools.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTool, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { BOARD_TYPES, FIELDS, OPS, type Analysis, type ChatAction, type Template } from "../shared/types.ts";
import { calaTool, queryRows } from "./cala.ts";
import { aiNoteStale, cleanBoard, noteFingerprint, paramKey } from "./engine.ts";
import { analyse, load, save } from "./store.ts";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 20;

const SYSTEM = `You help build data analyses in CalaViz, a notebook-style app over the Cala knowledge graph.

An analysis is a path of numbered cells that run top to bottom, each on the rows the cell above produced.
Cell 1 is the main query (source "main"). Cells 2+ are boards:
- filter: column, op (${OPS.join(" | ")}), value. "is empty" / "is not empty" ignore value. Numeric ops parse the first number with K/M/B. Blank value = ignored.
- aggregate: group, fn (count|sum|avg), metric. Output columns: the group column plus "count" or "<fn>_<metric>", sorted largest first.
- split: column, sep (default ","). One row per item of a list cell: turns "Sequoia Capital, Benchmark" into one row each, so you can count edges (investors, founders, co-investors).
- sort: column, order (desc|asc). Numbers sort as numbers; cells without a number go last. Sort years asc before a line chart.
- check: claim (label), column, test (sum|max|contains), value (the claimed figure or name; {{params}} work), tolerance (% for sum/max, default 20). Compares a claim with the rows at that step and gives a verdict (matches / differs / not in sources). Does not change rows.
- chart: kind (bar|line), x, y. Needs numbers in y. Does not change rows.
- graph: source, target (two columns). Draws a network: one edge per (source, target) pair, weighted by rows. Use after split to turn a list column into edges, e.g. split investors, then graph name → investors. Does not change rows.
- note: text. The insight in words.
- query: name, query. Starts a new source; cells below work on its rows. Earlier sources stay joinable by name.
- join: other (a source name above this cell), on (column). Left join on exact case-insensitive text, first match; clashing columns become "<source>.<column>".
{{param}} works in queries, filter values and notes; values live in the template params.

Cala query syntax (dot notation): start with an entity (companies, people, or a type like Company), chain filters with dots,
navigate to related entities by name (people.role=CEO.company.industry=fintech, companies.founders.name=X, companies.investors=Sequoia Capital).
Operators = != > < >= <=; AND / OR combine values of one field; order_by=field ASC|DESC; limit=N; return(f1, f2) projects columns (keep name).
Cala values are often prose ("~$9.4B raised; ~$159B valuation"), so check sample rows before summing or charting a column.
Every new Cala query takes 15-60 seconds; results are cached, so reuse queries you already ran.

How to work:
- Call get_analysis first to see the current cells, their columns, row counts and errors. The user may have edited it since your last turn.
- Before putting a new query in a cell, run_cala_query it and look at the columns and sample rows.
- Every edit tool returns the re-run analysis. Check the cell you touched for errors or 0 rows and fix it before you finish.
- Prefer few, meaningful cells. Add a note cell with the insight when you build a chart.
- Reply in two or three short sentences: what you changed and what the result shows. Refer to cells by number.`;

type Json = Record<string, unknown>;

const tool = (name: string, description: string, properties: Json, required: string[] = []): BetaTool => ({
  name, description, input_schema: { type: "object", properties, required, additionalProperties: false },
});
const str = (description: string) => ({ type: "string", description });
const boardFields = Object.fromEntries(
  [...new Set(Object.values(FIELDS).flat())].map((f) => [f, str(`Board field "${f}". See the system prompt for which types use it.`)]),
);

const TOOLS: BetaTool[] = [
  tool("get_analysis", "Current template: params, main query, every cell with its settings, input columns, row count, sample rows and error.", {}),
  tool("run_cala_query", "Run a Cala dot-notation query (cached) and return its columns, row count and sample rows. Does not change the analysis.", { query: str("Resolved query, no {{params}}.") }, ["query"]),
  tool("search_entities", "Find Cala entities by name (fuzzy). Returns ids, names, types and descriptions.", { name: str("Entity name."), entity_type: str("Optional type filter, e.g. Company, Person.") }, ["name"]),
  tool("set_main_query", "Change cell 1: the main query, the template name, and/or param values. Omitted fields stay as they are.", {
    query: str("Main Cala query; may contain {{params}}."),
    name: str("Template name."),
    params: { type: "object", description: "Param values to set, e.g. {\"industry\": \"fintech\"}.", additionalProperties: { type: "string" } },
  }),
  tool("add_cell", "Add a board cell. Inserted at `cell` (2 = first after the main query) or appended when omitted.", {
    type: { type: "string", enum: BOARD_TYPES }, cell: { type: "integer", minimum: 2 }, ...boardFields,
  }, ["type"]),
  tool("update_cell", "Change fields of an existing board cell (cell number as shown, 2+). Omitted fields stay as they are.", {
    cell: { type: "integer", minimum: 2 }, ...boardFields,
  }, ["cell"]),
  tool("delete_cell", "Delete a board cell (cell number as shown, 2+).", { cell: { type: "integer", minimum: 2 } }, ["cell"]),
];

const sample = (rows: Json[], n: number) => rows.slice(0, n);

/** Compact view of an analysis for Claude: no full row dumps. */
function summary(a: Analysis): Json {
  return {
    name: a.template.name,
    params: a.template.params,
    cells: [
      { cell: 1, type: "query", source: "main", query: a.template.query, resolved: a.run.resolved, error: a.run.error || undefined,
        rowCount: a.run.rowCount, columns: a.run.columns, sample: sample(a.run.rows, 5) },
      ...a.run.steps.map((s, i) => ({
        cell: i + 2, ...s.board, error: s.error || undefined, info: s.info || undefined, inputColumns: s.columns,
        rowCount: s.rowCount, outputColumns: s.outColumns, sample: s.board.type === "note" ? undefined : sample(s.rows, 3),
      })),
    ],
  };
}

function boardIndex(t: Template, cell: unknown): number {
  const i = Number(cell) - 2;
  if (!Number.isInteger(i) || i < 0 || i >= t.boards.length) throw new Error(`No board cell ${String(cell)}. Board cells are 2..${t.boards.length + 1}.`);
  return i;
}

async function runTool(templateId: string, name: string, input: Json): Promise<Json> {
  if (name === "run_cala_query") {
    const rows = await queryRows(String(input.query ?? "").trim());
    return { rowCount: rows.length, columns: [...new Set(rows.flatMap(Object.keys))], sample: sample(rows, 8) };
  }
  if (name === "search_entities") {
    const args: Json = { name: input.name, limit: 8 };
    if (input.entity_type) args.entity_types = [input.entity_type];
    return (await calaTool("entity_search", args)) as Json;
  }
  const t = await load(templateId);
  if (name === "set_main_query") {
    if (typeof input.query === "string") t.query = input.query.trim();
    if (typeof input.name === "string" && input.name.trim()) t.name = input.name.trim();
    if (input.params && typeof input.params === "object") Object.assign(t.params, input.params);
  } else if (name === "add_cell") {
    const board = cleanBoard(input);
    const at = input.cell === undefined ? t.boards.length : Math.min(Number(input.cell) - 2, t.boards.length);
    t.boards.splice(Math.max(at, 0), 0, board);
  } else if (name === "update_cell") {
    const i = boardIndex(t, input.cell);
    const given = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "cell" && v !== undefined));
    t.boards[i] = cleanBoard({ ...t.boards[i], ...given, type: t.boards[i].type });
  } else if (name === "delete_cell") {
    t.boards.splice(boardIndex(t, input.cell), 1);
  } else if (name !== "get_analysis") {
    throw new Error(`Unknown tool ${name}.`);
  }
  if (name !== "get_analysis") await save(t);
  return summary(await analyse(t));
}

// Chat history per template, in memory: a restart starts a fresh conversation.
const histories = new Map<string, BetaMessageParam[]>();

export function resetChat(templateId: string): void {
  histories.delete(templateId);
}

// Text already written for a parameter set. A report run does not save, so the next run with the same values is free.
const noteCache = new Map<string, string>();

export function forgetAiNotes(templateId: string): void {
  for (const k of noteCache.keys()) if (k.startsWith(`${templateId}:`)) noteCache.delete(k);
}

async function composeNote(cells: Json[]): Promise<string> {
  if (!cells.some((c) => (c as { rowCount?: number }).rowCount)) return "No rows for these parameters, so there is nothing to add.";
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing. Put it in cala-data-visualization/.env.");
  const client = new Anthropic();
  // Structured output, so every note has the same three parts as the handwritten stories.
  const schema = {
    type: "object",
    properties: {
      headline: { type: "string", description: "STORY headline: the main finding in one sentence." },
      points: { type: "array", items: { type: "string" }, description: "2-4 short findings, each with the numbers or names behind it." },
      beneficiaries: {
        type: "string",
        description: "WHO BENEFITS FROM THIS: who gains from this finding (e.g. which kind of fund, founder, acquirer or LP) and why, 1-2 sentences.",
      },
      meaning: { type: "string", description: "WHAT IT MEANS: what an investor should do or watch, 1-2 sentences." },
      trust: { type: "string", description: "TRUST: what in this data not to rely on (gaps, prose figures, small samples), 1-2 sentences." },
    },
    required: ["headline", "points", "beneficiaries", "meaning", "trust"],
    additionalProperties: false,
  };
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `You write the note under a CalaViz report. The JSON is the cells above this note, already run for the parameters in it.
Write the story, who benefits from it, what it means, and what not to trust for these parameters. Use only numbers and names that appear in the JSON. If a figure is not there, leave it out.
Under 160 words in total. Refer to cells by number when it helps the reader find a figure.`,
    messages: [{ role: "user", content: JSON.stringify(cells) }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this note.");
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!raw) throw new Error("Claude returned an empty note.");
  const note = JSON.parse(raw) as { headline: string; points: string[]; beneficiaries: string; meaning: string; trust: string };
  return [
    `STORY: ${note.headline.trim()}`,
    ...note.points.map((p) => `- ${p.trim()}`),
    "",
    `WHO BENEFITS FROM THIS: ${note.beneficiaries.trim()}`,
    "",
    `WHAT IT MEANS: ${note.meaning.trim()}`,
    "",
    `TRUST: ${note.trust.trim()}`,
  ].join("\n");
}

// Part of every note's fingerprint: bump it when the note format changes, so existing notes rewrite once.
const NOTE_FORMAT = 3;

/**
 * Rewrite AI notes whose data changed: new parameter values, an edited query or cell above, or a different
 * Cala answer. Unchanged data costs no Claude call. Saves only when these are the template's own parameters,
 * so a report run with other values never overwrites the saved note.
 */
export async function rewriteAiNotes(a: Analysis): Promise<void> {
  const key = paramKey(a.template.params);
  const cells = summary(a).cells as { cell: number; type?: string }[];
  let dirty = false;
  for (let i = 0; i < a.template.boards.length; i++) {
    const board = a.template.boards[i];
    if (board.ai !== "1") continue;
    const above = cells.filter((c) => c.cell < i + 2 && c.type !== "note");
    const fingerprint = noteFingerprint(a.template.params, { format: NOTE_FORMAT, above });
    if (!aiNoteStale(board, fingerprint)) continue;
    const step = a.run.steps[i];
    const id = `${a.template.id}:${i}:${fingerprint}`;
    let text = noteCache.get(id);
    if (!text) {
      try {
        text = await composeNote(above);
        noteCache.set(id, text);
      } catch (err) {
        if (step) step.error = (err as Error).message;
        continue;
      }
    }
    if (board.text !== text || board.for !== fingerprint) {
      board.text = text;
      board.for = fingerprint;
      dirty = true;
    }
    if (step) step.text = text;
  }
  if (!dirty) return;
  try {
    const stored = await load(a.template.id);
    if (paramKey(stored.params) === key) await save(a.template);
  } catch {
    // No saved template. The response still carries the new text.
  }
}

/** Append an AI note. The following analysis writes it for the current parameters. */
export async function aiNote(templateId: string): Promise<Analysis> {
  const t = await load(templateId);
  t.boards.push({ type: "note", text: "", ai: "1", for: "" });
  return analyse(await save(t));
}

export async function chat(templateId: string, text: string): Promise<{ reply: string; actions: ChatAction[] }> {
  await load(templateId); // 404 before spending a Claude call
  const client = new Anthropic();
  const history = histories.get(templateId) ?? [];
  const messages: BetaMessageParam[] = [...history, { role: "user", content: text }];
  const actions: ChatAction[] = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools: TOOLS,
      cache_control: { type: "ephemeral" },
      messages,
    });
    messages.push({ role: "assistant", content: response.content });
    const reply = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (response.stop_reason === "refusal") return finish("Claude declined this request.");
    if (response.stop_reason === "max_tokens") return finish(reply || "The reply was cut off. Try a smaller request.");
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) return finish(reply || "Done.");
    const results: BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      try {
        const out = await runTool(templateId, use.name, use.input as Json);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
        actions.push({ tool: use.name, input: use.input, error: false });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: (err as Error).message, is_error: true });
        actions.push({ tool: use.name, input: use.input, error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return finish(`Stopped after ${MAX_TURNS} steps. Ask me to continue.`);

  function finish(reply: string) {
    histories.set(templateId, messages);
    return { reply, actions };
  }
}
