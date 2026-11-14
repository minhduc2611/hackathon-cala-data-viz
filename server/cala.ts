// Cala over MCP (https://api.cala.ai/mcp/), every call cached on disk keyed by the request.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "../shared/types.ts";
import { ROOT } from "./env.ts";

const MCP = "https://api.cala.ai/mcp/";
export const CACHE = join(ROOT, ".cache");

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

export function cachePath(signature: string): string {
  return join(CACHE, createHash("sha256").update(signature).digest("hex") + ".json");
}

// Same request in flight twice (page + chat) waits on one Cala call.
const inFlight = new Map<string, Promise<unknown>>();

async function cached<T>(signature: string, fetcher: () => Promise<T>): Promise<T> {
  const path = cachePath(signature);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  let pending = inFlight.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = fetcher().then((value) => {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(path, JSON.stringify(value));
      return value;
    });
    pending.finally(() => inFlight.delete(path)).catch(() => {});
    inFlight.set(path, pending);
  }
  return pending;
}

/** Rows for one resolved query. Key is the query text, as the old app stored it, so its cache still hits. */
export function queryRows(query: string): Promise<Row[]> {
  return cached(query, async () => {
    const payload = await callTool("knowledge_query", { input: query, return_entities: false });
    const rows = Array.isArray(payload?.results) ? payload.results : null;
    if (!rows) throw new CalaError("Cala returned no results list.");
    if (rows[0]?.error) throw new CalaError(String(rows[0].error));
    return rows
      .filter((r: unknown) => r && typeof r === "object")
      .map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  });
}

export function forgetQuery(query: string): void {
  if (existsSync(cachePath(query))) unlinkSync(cachePath(query));
}

/** Any other Cala MCP tool (entity_search, entity_introspection), cached by tool + arguments. */
export function calaTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return cached(`${name}:${JSON.stringify(args)}`, () => callTool(name, args));
}

export function cachedQueryFiles(): string[] {
  return existsSync(CACHE) ? readdirSync(CACHE).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).map((f) => join(CACHE, f)) : [];
}
