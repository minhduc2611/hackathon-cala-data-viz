import type { Selection } from "../../shared/selection.ts";
import type { Analysis, Board, ChatReply, Suggestions, Template } from "../../shared/types.ts";

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

export const api = {
  list: () => call<Pick<Template, "id" | "name" | "query">[]>("GET", "/templates"),
  create: (name: string) => call<Analysis>("POST", "/templates", { name }),
  deleteTemplate: (id: string) => call<object>("DELETE", `/templates/${id}`),
  get: (id: string) => call<Analysis>("GET", `/templates/${id}`),
  update: (id: string, patch: Partial<Pick<Template, "name" | "query" | "params">>) => call<Analysis>("PUT", `/templates/${id}`, patch),
  play: (id: string, params: Record<string, string>, selection?: Selection | null) =>
    call<Analysis>("POST", `/templates/${id}/run`, { params, selection: selection ?? undefined }),
  refresh: (id: string) => call<Analysis>("POST", `/templates/${id}/refresh`),
  addBoard: (id: string, board: Board, at?: number) => call<Analysis>("POST", `/templates/${id}/boards`, { ...board, at }),
  saveBoard: (id: string, i: number, board: Board) => call<Analysis>("PUT", `/templates/${id}/boards/${i}`, board),
  deleteBoard: (id: string, i: number) => call<Analysis>("DELETE", `/templates/${id}/boards/${i}`),
  suggestions: () => call<Suggestions>("GET", "/suggestions"),
  chat: (id: string, message: string) => call<ChatReply>("POST", `/templates/${id}/chat`, { message }),
  resetChat: (id: string) => call<object>("DELETE", `/templates/${id}/chat`),
};
