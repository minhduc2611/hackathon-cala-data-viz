// JSON API on :5055. In production it also serves the built React app from dist/.
import "./env.ts";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Template } from "../shared/types.ts";
import { chat, resetChat } from "./agent.ts";
import { calaCache, dbName, templates } from "./db.ts";
import { cleanBoard } from "./engine.ts";
import { ROOT } from "./env.ts";
import { NotFound, analyse, create, list, load, refresh, remove, save, suggestions } from "./store.ts";

const PORT = Number(process.env.PORT ?? 5055);
const DIST = join(ROOT, "dist");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

class BadRequest extends Error {}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new BadRequest("Body must be a JSON object.");
  }
}

function cleanParams(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([k]) => /^\w+$/.test(k)).map(([k, v]) => [k, String(v).trim()]));
}

function boardIndex(t: Template, raw: string): number {
  const i = Number(raw);
  if (!Number.isInteger(i) || i < 0 || i >= t.boards.length) throw new BadRequest(`No board ${raw}.`);
  return i;
}

async function route(req: IncomingMessage, url: URL): Promise<unknown> {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
  const method = req.method ?? "GET";
  if (parts[0] === "suggestions" && method === "GET") return suggestions();
  if (parts[0] === "health" && method === "GET") {
    // Which store this deploy reads, without exposing the host or credentials.
    return {
      storage: "mongodb",
      database: dbName(),
      templates: await (await templates()).countDocuments(),
      calaCache: await (await calaCache()).countDocuments(), // cached Cala answers: each one is a call not paid for again
    };
  }
  if (parts[0] !== "templates") throw new NotFound(url.pathname);
  if (parts.length === 1) {
    if (method === "GET") return (await list()).map(({ id, name, query }) => ({ id, name, query }));
    if (method === "POST") return analyse(await create(String((await body(req)).name ?? "")));
  }
  if (parts.length === 2 && method === "DELETE") {
    await remove(parts[1]);
    return {};
  }
  const t = await load(parts[1] ?? "");
  const [, , sub, index] = parts;
  if (!sub && method === "GET") return analyse(t);
  if (!sub && method === "PUT") {
    const b = await body(req);
    if (typeof b.name === "string" && b.name.trim()) t.name = b.name.trim();
    if (typeof b.query === "string") t.query = b.query.trim();
    Object.assign(t.params, cleanParams(b.params));
    if (b.paramHints && typeof b.paramHints === "object") {
      const hints = Object.fromEntries(Object.entries(cleanParams(b.paramHints)).filter(([, v]) => v));
      if (Object.keys(hints).length) t.paramHints = hints;
      else delete t.paramHints;
    }
    return analyse(await save(t));
  }
  if (sub === "run" && method === "POST") {
    // Report view: run with other parameter values without saving them.
    const b = await body(req);
    // Optional interactive selection: one bar of a chart cell, applied to the cells below it.
    const s = b.selection;
    const labels = Array.isArray(s?.labels) ? s.labels.filter((l: unknown) => typeof l === "string").slice(0, 100) : [];
    const selection = s && Number.isInteger(s.step) && s.step >= 0 && s.step < t.boards.length && labels.length
      ? { step: s.step as number, labels: labels as string[] }
      : undefined;
    const run = await analyse({ ...t, params: { ...t.params, ...cleanParams(b.params) } }, selection);
    return { ...run, savedParams: t.params };
  }
  if (sub === "refresh" && method === "POST") {
    await refresh(t);
    return analyse(t);
  }
  if (sub === "boards") {
    if (index === undefined && method === "POST") {
      const b = await body(req);
      // Optional `at` (board index) inserts there, e.g. a drill-down filter before an aggregate; default appends.
      const at = Number.isInteger(b.at) ? Math.min(Math.max(b.at, 0), t.boards.length) : t.boards.length;
      t.boards.splice(at, 0, cleanBoard(b));
      return analyse(await save(t));
    }
    const i = boardIndex(t, index ?? "");
    if (method === "PUT") t.boards[i] = cleanBoard({ ...(await body(req)), type: t.boards[i].type });
    else if (method === "DELETE") t.boards.splice(i, 1);
    else throw new NotFound(url.pathname);
    return analyse(await save(t));
  }
  if (sub === "chat" && method === "POST") {
    const message = String((await body(req)).message ?? "").trim();
    if (!message) throw new BadRequest("Write a message.");
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequest("ANTHROPIC_API_KEY missing. Put it in cala-data-visualization/.env.");
    const result = await chat(t.id, message);
    return { ...result, analysis: await analyse(await load(t.id)) };
  }
  if (sub === "chat" && method === "DELETE") {
    resetChat(t.id);
    return {};
  }
  throw new NotFound(url.pathname);
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const file = normalize(join(DIST, pathname === "/" ? "index.html" : pathname));
  const target = file.startsWith(DIST) && existsSync(file) && extname(file) ? file : join(DIST, "index.html");
  if (!existsSync(target)) return send(res, 404, { error: "Frontend not built. Run npm run build, or use npm run dev." });
  res.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream" });
  res.end(readFileSync(target));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
  try {
    send(res, 200, await route(req, url));
  } catch (err) {
    if (err instanceof NotFound) return send(res, 404, { error: "Not found." });
    if (err instanceof BadRequest || (err instanceof Error && err.message.startsWith("Unknown cell type"))) {
      return send(res, 400, { error: err.message });
    }
    if (err instanceof Anthropic.APIError) {
      const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
      return send(res, 502, { error: `Claude API ${err.status ?? ""}: ${detail}` });
    }
    console.error(err);
    send(res, 500, { error: (err as Error).message });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`API listening on port ${PORT}`));
