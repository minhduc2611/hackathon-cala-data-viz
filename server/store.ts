// Templates in MongoDB, running a template, and the query-box suggestions.
import { randomBytes } from "node:crypto";
import type { Selection } from "../shared/selection.ts";
import type { Analysis, Suggestions, Template } from "../shared/types.ts";
import { CalaError, cachedJson, cachedQueryRows, forgetQuery, queryRows } from "./cala.ts";
import { templates, toTemplate } from "./db.ts";
import { ROW_CAP, columns, fill, paramNames, runWithSelection, unset } from "./engine.ts";
import { entitySchema } from "./schema.ts";

// Field names from Cala's own examples. Cala has no field schema to fetch.
const BASE_FIELDS = ["name", "industry", "founded_year", "role", "company", "investors", "series", "founders"];

export class NotFound extends Error {}

function checkId(id: string): string {
  // The id comes from the URL; anything else is a 404 before it reaches the database.
  if (!/^[a-z0-9-]+$/.test(id)) throw new NotFound(id);
  return id;
}

export async function load(id: string): Promise<Template> {
  const doc = await (await templates()).findOne({ _id: checkId(id) });
  if (!doc) throw new NotFound(id);
  return toTemplate(doc);
}

export async function save(template: Template): Promise<Template> {
  const { id, ...rest } = template;
  await (await templates()).replaceOne({ _id: checkId(id) }, { ...rest, id }, { upsert: true });
  return template;
}

export async function remove(id: string): Promise<void> {
  const { deletedCount } = await (await templates()).deleteOne({ _id: checkId(id) });
  if (!deletedCount) throw new NotFound(id);
}

export async function list(): Promise<Template[]> {
  return (await (await templates()).find().sort({ _id: 1 }).toArray()).map(toTemplate);
}

export function create(name: string): Promise<Template> {
  return save({ id: randomBytes(4).toString("hex"), name: name.trim() || "Untitled", query: "", params: {}, boards: [] });
}

export async function analyse(template: Template, selection?: Selection): Promise<Analysis> {
  // Start every query at once; the path below then reads them from the cache or the in-flight call.
  const queries = [template.query, ...template.boards.filter((b) => b.type === "query").map((b) => b.query)];
  await Promise.allSettled(
    queries.filter((q) => !unset(q, template.params).length).map((q) => fill(q, template.params).trim()).filter(Boolean).map(queryRows),
  );
  const resolved = fill(template.query, template.params).trim();
  const blank = unset(template.query, template.params);
  let rows: Awaited<ReturnType<typeof queryRows>> = [];
  let error = "";
  if (blank.length) error = "Set a value for: " + blank.join(", ");
  else if (resolved) {
    try {
      rows = await queryRows(resolved);
    } catch (err) {
      if (!(err instanceof CalaError)) throw err;
      error = err.message;
    }
  }
  const { steps } = await runWithSelection(rows, template.boards, template.params, queryRows, selection);
  return {
    template,
    paramNames: paramNames(template),
    run: { resolved, error, rows: rows.slice(0, ROW_CAP), rowCount: rows.length, columns: columns(rows), steps },
  };
}

/** Drop the cached rows of every query in the template, so the next run refetches from Cala. */
export async function refresh(template: Template): Promise<void> {
  for (const query of [template.query, ...template.boards.map((b) => b.query)]) {
    const resolved = fill(query, template.params).trim();
    if (resolved) await forgetQuery(resolved);
  }
}

let entityTypes: string[] | undefined;

let suggestionMemo: { at: number; value: Suggestions } | undefined;
const SUGGESTION_TTL = 60_000; // new cached query results show up in suggestions within a minute

/** Words for the query box, built at most once a minute (it reads hundreds of cached results from MongoDB). */
export async function suggestions(): Promise<Suggestions> {
  if (suggestionMemo && Date.now() - suggestionMemo.at < SUGGESTION_TTL) return suggestionMemo.value;
  const value = await buildSuggestions();
  // Keep it only once the entity schema is complete, so an early partial list is not served for a minute.
  if (Object.keys(value.schema ?? {}).length >= 4) suggestionMemo = { at: Date.now(), value };
  return value;
}

/** Hints only: Cala interprets field names itself, so this never validates. */
async function buildSuggestions(): Promise<Suggestions> {
  if (!entityTypes) {
    try {
      entityTypes = await cachedJson("openapi-entity-types", async () => {
        const doc = await (await fetch("https://api.cala.ai/openapi.json", { signal: AbortSignal.timeout(5000) })).json();
        return doc.components.schemas.Entity.properties.entity_type.enum as string[];
      });
    } catch {
      entityTypes = undefined; // offline: try again next time, suggest without types now
    }
  }
  const fields = new Set(BASE_FIELDS);
  // Values per column seen in cached results, most frequent first: what to offer after "location=".
  const counts = new Map<string, Map<string, number>>();
  for (const data of await cachedQueryRows()) {
    for (const row of data) {
      for (const [key, value] of Object.entries(row)) {
        fields.add(key);
        // Prose, money and placeholders ("—") are not filter values.
        if (!value || value.length > 40 || /[;$]/.test(value) || !/[\p{L}\p{N}]/u.test(value)) continue;
        const c = counts.get(key) ?? new Map<string, number>();
        c.set(value, (c.get(value) ?? 0) + 1);
        counts.set(key, c);
      }
    }
  }
  const values: Record<string, string[]> = {};
  for (const [key, c] of counts) values[key] = [...c].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([v]) => v);
  const schema = await entitySchema();
  // Real neighbours from the schema samples: industry -> FINTECH, SOFTWARE_AND_SERVICES, …
  for (const type of Object.values(schema)) {
    for (const r of type.relations) if (r.examples?.length) values[r.word] = [...new Set([...(values[r.word] ?? []), ...r.examples])];
  }
  const aliases: Record<string, string> = { companies: "Company", people: "Person", industries: "Industry", countries: "Country" };
  for (const type of entityTypes ?? []) aliases[type.toLowerCase()] = type;
  return { entities: ["companies", "people", ...(entityTypes ?? [])], fields: [...fields], schema, aliases, values };
}
