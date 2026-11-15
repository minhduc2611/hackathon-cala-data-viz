import type { Selection } from "../../shared/selection.ts";
import type { Analysis, Board, ChatEvent, ChatReply, Suggestions, Template } from "../../shared/types.ts";
import { forget, peek, put } from "./clientCache.ts";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// Client cache keys. A template's edit view and its reports are dropped together whenever it changes.
const analysisKey = (id: string) => `t:${id}:analysis`;
const playKey = (id: string, params: Record<string, string>, selection?: Selection | null) =>
  `t:${id}:play:${JSON.stringify([Object.entries(params).sort(), selection ?? null])}`;

/** After any change to a template: cache the new state, drop its now-stale reports. */
const changed = (id: string) => (a: Analysis) => {
  forget(`t:${id}:`);
  return put(analysisKey(id), a);
};

/** Cached answers to show instantly while the real request is still running. */
export const cachedView = {
  analysis: (id: string) => peek<Analysis>(analysisKey(id)),
  play: (id: string, params: Record<string, string>, selection?: Selection | null) => peek<Analysis>(playKey(id, params, selection)),
  suggestions: () => peek<Suggestions>("suggestions"),
};

export const api = {
  list: () => call<Pick<Template, "id" | "name" | "query">[]>("GET", "/templates"),
  create: (name: string) => call<Analysis>("POST", "/templates", { name }).then((a) => put(analysisKey(a.template.id), a)),
  deleteTemplate: (id: string) => call<object>("DELETE", `/templates/${id}`).then((r) => (forget(`t:${id}:`), r)),
  get: (id: string) => call<Analysis>("GET", `/templates/${id}`).then((a) => put(analysisKey(id), a)),
  update: (id: string, patch: Partial<Pick<Template, "name" | "query" | "params" | "paramHints">>) =>
    call<Analysis>("PUT", `/templates/${id}`, patch).then(changed(id)),
  play: (id: string, params: Record<string, string>, selection?: Selection | null) =>
    call<Analysis>("POST", `/templates/${id}/run`, { params, selection: selection ?? undefined }).then((a) => put(playKey(id, params, selection), a)),
  refresh: (id: string) => call<Analysis>("POST", `/templates/${id}/refresh`).then(changed(id)),
  addBoard: (id: string, board: Board, at?: number) => call<Analysis>("POST", `/templates/${id}/boards`, { ...board, at }).then(changed(id)),
  aiNote: (id: string) => call<Analysis>("POST", `/templates/${id}/ainote`).then(changed(id)),
  saveBoard: (id: string, i: number, board: Board) => call<Analysis>("PUT", `/templates/${id}/boards/${i}`, board).then(changed(id)),
  deleteBoard: (id: string, i: number) => call<Analysis>("DELETE", `/templates/${id}/boards/${i}`).then(changed(id)),
  suggestions: () => call<Suggestions>("GET", "/suggestions").then((s) => put("suggestions", s)),
  /** Sends a message and streams the run's events to `onEvent`. If a run is already going, follows that one instead. */
  chat: async (id: string, message: string, onEvent: (e: ChatEvent) => void): Promise<ChatReply> => {
    const res = await fetch(`/api/templates/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return (await readRun(id, res, onEvent))!;
  },
  /** Follows a run already going on the server (after a reload or a dropped connection); null when none is. */
  followChat: async (id: string, onEvent: (e: ChatEvent) => void): Promise<ChatReply | null> =>
    readRun(id, await fetch(`/api/templates/${id}/chat/stream`), onEvent),
  resetChat: (id: string) => call<object>("DELETE", `/templates/${id}/chat`),
};

/** Reads a streamed chat run (NDJSON) to its end. Null when the server answered JSON: no run to follow. */
async function readRun(id: string, res: Response, onEvent: (e: ChatEvent) => void): Promise<ChatReply | null> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  if (!res.headers.get("Content-Type")?.includes("ndjson")) return null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    // If the connection drops, the server keeps working and saving; say so instead of a bare "network error".
    const { value, done } = await reader.read().catch(() => {
      throw new Error("Lost the connection to Cala AI. It keeps working on the server: reload the page to follow it again.");
    });
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const e = JSON.parse(line) as ChatEvent;
      if (e.type === "analysis") changed(id)(e.analysis);
      if (e.type === "error") throw new Error(e.error);
      onEvent(e);
      if (e.type === "done") return (changed(id)(e.analysis), e);
    }
    if (done) throw new Error("The connection closed before Cala AI finished. Reload the page to follow it again.");
  }
}
