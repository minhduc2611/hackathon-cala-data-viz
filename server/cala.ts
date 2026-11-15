// Cala over MCP (https://api.cala.ai/mcp/), every call cached in MongoDB keyed by the request.
import { createHash } from "node:crypto";
import type { Row } from "../shared/types.ts";
import { calaCache, type CacheDoc } from "./db.ts";

const MCP = "https://api.cala.ai/mcp/";

export class CalaError extends Error {}

function key(): string {
  const value = (process.env.CALA_API_KEY ?? "").trim();
  if (!value) throw new CalaError("CALA_API_KEY missing. Put it in cala-data-visualization/.env or cala-data/.env.");
  return value;
}

let session: string | undefined;
let nextId = 1;

async function post(body: object, sessionId?: string): Promise<{ message: any; sessionId?: string }> {
  const headers: Record<string, string> = {
    "X-API-KEY": key(),
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  let res: Response;
  try {
    res = await fetch(MCP, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  } catch (err) {
    throw new CalaError(`Cala call failed: ${(err as Error).message}`);
  }
  const raw = await res.text();
  if (res.status === 429) throw new CalaError("Cala rate limit (429). Not retrying.");
  if (!res.ok) throw Object.assign(new CalaError(`Cala ${res.status}: ${raw.slice(0, 300)}`), { status: res.status });
  // Streamable HTTP answers as plain JSON or as SSE; the last data: line is the reply.
  const text = raw.trim();
  const blobs = text.startsWith("{")
    ? [text]
    : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
  return {
    message: blobs.length ? JSON.parse(blobs[blobs.length - 1]) : {},
    sessionId: res.headers.get("mcp-session-id") ?? sessionId,
  };
}

async function open(): Promise<string> {
  const { message, sessionId } = await post({
    jsonrpc: "2.0",
    id: nextId++,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cala-contour", version: "1.0" } },
  });
  if (message.error) throw new CalaError(`Cala MCP initialize failed: ${message.error.message ?? JSON.stringify(message.error)}`);
  // Cala's server is stateless today and sends no session id; "" means none.
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
  return sessionId ?? "";
}

// Parallel calls share one session instead of each opening their own.
let opening: Promise<string> | undefined;
function sessionId(): Promise<string> {
  if (session !== undefined) return Promise.resolve(session);
  opening ??= open().then(
    (id) => ((session = id), (opening = undefined), id),
    (err) => { opening = undefined; throw err; },
  );
  return opening;
}

async function callTool(name: string, args: object): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const id = await sessionId();
    try {
      const { message } = await post(
        { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } },
        id,
      );
      if (message.error) throw new CalaError(message.error.message ?? JSON.stringify(message.error));
      const result = message.result ?? {};
      const text = (result.content ?? []).map((b: any) => (b.type === "text" ? b.text : "")).join("");
      if (result.isError) throw new CalaError(text || "Cala MCP tool failed.");
      return result.structuredContent ?? JSON.parse(text);
    } catch (err) {
      // An expired session answers 400/404: open a new one once.
      const status = (err as { status?: number }).status;
      if (attempt === 0 && (status === 400 || status === 404)) {
        if (session === id) session = undefined;
        continue;
      }
      throw err;
    }
  }
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Cache key: sha256 of the request. Same as the old .cache/ file names, so imported entries still hit. */
const keyOf = (signature: string) => createHash("sha256").update(signature).digest("hex");

// shortcut: in-memory layer is unbounded; fine for a few thousand Cala answers. Add an LRU if memory grows.
const memory = new Map<string, unknown>();
// Same request in flight twice (page + chat) waits on one Cala call.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Every Cala answer is cached in MongoDB ("cala_cache") with a memory layer in front: Cala is only called on a
 * true miss, which saves credits and makes repeat runs instant on every machine and deploy. If MongoDB is
 * unreachable, the call still works, just uncached.
 */
async function cached<T>(signature: string, kind: CacheDoc["kind"], fetcher: () => Promise<T>): Promise<T> {
  const key = keyOf(signature);
  if (memory.has(key)) return memory.get(key) as T;
  let pending = inFlight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      const store = await calaCache().catch((err) => { console.warn(`Cala cache unavailable: ${(err as Error).message}`); });
      const hit = store ? await store.findOne({ _id: key }).catch(() => null) : null;
      if (hit) {
        const value = JSON.parse(hit.json) as T;
        memory.set(key, value);
        return value;
      }
      const value = await fetcher();
      memory.set(key, value);
      await store?.updateOne(
        { _id: key },
        { $set: { kind, json: JSON.stringify(value), signature: signature.slice(0, 500), createdAt: new Date() } },
        { upsert: true },
      ).catch((err) => console.warn(`Could not cache a Cala answer: ${(err as Error).message}`));
      return value;
    })();
    pending.finally(() => inFlight.delete(key)).catch(() => {});
    inFlight.set(key, pending);
  }
  return pending;
}

/** Any cacheable JSON that is not a Cala MCP call (e.g. Cala's public OpenAPI entity types). */
export function cachedJson<T>(signature: string, fetcher: () => Promise<T>): Promise<T> {
  return cached(`meta:${signature}`, "meta", fetcher);
}

/** Rows for one resolved query. Key is the query text, as the old app stored it, so its cache still hits. */
export function queryRows(query: string): Promise<Row[]> {
  return cached(query, "query", async () => {
    const payload = await callTool("knowledge_query", { input: query, return_entities: false });
    const rows = Array.isArray(payload?.results) ? payload.results : null;
    if (!rows) throw new CalaError("Cala returned no results list.");
    if (rows[0]?.error) throw new CalaError(String(rows[0].error));
    return rows
      .filter((r: unknown) => r && typeof r === "object")
      .map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  });
}

/** "Refresh data": drop one query's cached rows so the next run asks Cala again. */
export async function forgetQuery(query: string): Promise<void> {
  const key = keyOf(query);
  memory.delete(key);
  await (await calaCache()).deleteOne({ _id: key });
}

/** Any other Cala MCP tool (entity_search, entity_introspection, entity_retrieval), cached by tool + arguments. */
export function calaTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return cached(`${name}:${JSON.stringify(args)}`, "tool", () => callTool(name, args));
}

/** Rows of recent cached queries, for the query-box field and value suggestions. */
export async function cachedQueryRows(limit = 300): Promise<Row[][]> {
  const store = await calaCache().catch(() => undefined);
  if (!store) return [];
  const docs = await store.find({ kind: "query" }, { projection: { json: 1 } }).sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map((d) => JSON.parse(d.json) as Row[]).filter(Array.isArray);
}
