// Templates in MongoDB, running a template, and the query-box suggestions.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Analysis, Suggestions, Template } from "../shared/types.ts";
import { CACHE, CalaError, cachedQueryFiles, forgetQuery, queryRows } from "./cala.ts";
import { templates, toTemplate } from "./db.ts";
import { ROW_CAP, columns, fill, paramNames, runPath, unset } from "./engine.ts";

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

export async function analyse(template: Template): Promise<Analysis> {
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
  const { steps } = await runPath(rows, template.boards, template.params, queryRows);
  return {
    template,
    paramNames: paramNames(template),
    run: { resolved, error, rows: rows.slice(0, ROW_CAP), rowCount: rows.length, columns: columns(rows), steps },
  };
}

/** Drop the cached rows of every query in the template, so the next run refetches from Cala. */
export function refresh(template: Template): void {
  for (const query of [template.query, ...template.boards.map((b) => b.query)]) {
    const resolved = fill(query, template.params).trim();
    if (resolved) forgetQuery(resolved);
  }
}

let entityTypes: string[] | undefined;

/** Words for the query box. Hints only: Cala interprets field names itself, so this never validates. */
export async function suggestions(): Promise<Suggestions> {
  const typesFile = join(CACHE, "entity_types.json");
  if (!entityTypes) {
    try {
      if (existsSync(typesFile)) entityTypes = JSON.parse(readFileSync(typesFile, "utf8"));
      else {
        const doc = await (await fetch("https://api.cala.ai/openapi.json", { signal: AbortSignal.timeout(5000) })).json();
        entityTypes = doc.components.schemas.Entity.properties.entity_type.enum as string[];
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(typesFile, JSON.stringify(entityTypes));
      }
    } catch {
      entityTypes = undefined; // offline: try again next time, suggest without types now
    }
  }
  const fields = new Set(BASE_FIELDS);
  for (const file of cachedQueryFiles()) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(data)) for (const key of columns(data)) fields.add(key);
  }
  return { entities: ["companies", "people", ...(entityTypes ?? [])], fields: [...fields] };
}
