import type { Selection } from "../../shared/selection.ts";
import type { Analysis, Board, ChatReply, Suggestions, Template } from "../../shared/types.ts";
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
  saveBoard: (id: string, i: number, board: Board) => call<Analysis>("PUT", `/templates/${id}/boards/${i}`, board).then(changed(id)),
  deleteBoard: (id: string, i: number) => call<Analysis>("DELETE", `/templates/${id}/boards/${i}`).then(changed(id)),
  suggestions: () => call<Suggestions>("GET", "/suggestions").then((s) => put("suggestions", s)),
  chat: (id: string, message: string) =>
    call<ChatReply>("POST", `/templates/${id}/chat`, { message }).then((r) => (changed(id)(r.analysis), r)),
  resetChat: (id: string) => call<object>("DELETE", `/templates/${id}/chat`),
};
