import { useEffect, useRef, useState } from "react";
import type { Analysis, ChatAction } from "../../shared/types.ts";
import { api } from "./api.ts";

interface Message {
  role: "user" | "claude" | "error";
  text: string;
  actions?: ChatAction[];
}

const ACTION_LABEL: Record<string, string> = {
  get_analysis: "read the analysis",
  run_cala_query: "ran a Cala query",
  search_entities: "searched entities",
  set_main_query: "changed cell 1",
  add_cell: "added a cell",
  update_cell: "updated a cell",
  delete_cell: "deleted a cell",
  get_cala_skill: "read the Cala skill",
  cala_call: "called Cala",
  add_ai_note: "added an AI note",
};

const BUILD_PROMPT = "Build a report from this query: plan 2-4 sections, add the cells and charts, check them, and finish with an AI note.";

function describe(a: ChatAction): string {
  const input = a.input as Record<string, unknown>;
  const args = input.arguments as Record<string, unknown> | undefined;
  const detail = input.query ?? input.name ?? input.section ?? (input.tool ? `${input.tool}${args?.input ? ` "${args.input}"` : ""}` : undefined)
    ?? (input.cell !== undefined ? `cell ${input.cell}` : input.type) ?? "";
  return `${ACTION_LABEL[a.tool] ?? a.tool}${detail ? `: ${String(detail)}` : ""}${a.error ? " (failed)" : ""}`;
}

/** Chat with Cala AI, docked bottom right. It edits the analysis through tools; the page shows the result. */
export function Chat({ id, onAnalysis }: { id: string; onAnalysis: (a: Analysis) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [live, setLive] = useState<{ round: number; actions: ChatAction[] }>({ round: 0, actions: [] });
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, working, live]);

  // While Cala AI works (a report can take minutes), show each step as it happens.
  useEffect(() => {
    if (!working) return;
    setLive({ round: 0, actions: [] });
    const timer = setInterval(() => {
      api.chatProgress(id).then((p) => { if (p.running) setLive({ round: p.round, actions: p.actions }); }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [working, id]);

  async function send(e: React.FormEvent, preset?: string) {
    e.preventDefault();
    const message = (preset ?? text).trim();
    if (!message || working) return;
    setText("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setWorking(true);
    try {
      const reply = await api.chat(id, message);
      setMessages((m) => [...m, { role: "claude", text: reply.reply, actions: reply.actions }]);
      onAnalysis(reply.analysis);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", text: (err as Error).message }]);
    } finally {
      setWorking(false);
    }
  }

  async function reset() {
    await api.resetChat(id).catch(() => {});
    setMessages([]);
  }

  if (!open) {
    return (
      <button type="button" className="chat-toggle" onClick={() => setOpen(true)} aria-expanded={false}>
        Ask Cala AI
      </button>
    );
  }
  return (
    <aside className="chat" aria-label="Chat with Cala AI">
      <header>
        <strong>Cala AI</strong>
        <span>
          <button type="button" className="link" onClick={reset} disabled={working}>New chat</button>{" "}
          <button type="button" className="link" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
        </span>
      </header>
      <div className="chat-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <>
            <p className="muted">Ask for an analysis, e.g. "Chart fintech companies by country" or "Why is cell 5 empty?". Cala AI runs queries and adds cells for you.</p>
            <button type="button" className="quiet chat-starter" disabled={working} onClick={(e) => send(e, BUILD_PROMPT)}>
              Build a report from this query
            </button>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.actions && m.actions.length > 0 && (
              <ul className="actions">{m.actions.map((a, j) => <li key={j}>{describe(a)}</li>)}</ul>
            )}
            <p>{m.text}</p>
          </div>
        ))}
        {working && (
          <div className="msg claude" role="status">
            {live.actions.length > 0 && <ul className="actions">{live.actions.map((a, j) => <li key={j}>{describe(a)}</li>)}</ul>}
            <p className="muted">
              Cala AI is working{live.round ? ` (round ${live.round})` : ""}. New Cala queries take up to a minute each…
            </p>
          </div>
        )}
      </div>
      <form onSubmit={send}>
        <textarea
          rows={2}
          aria-label="Message"
          value={text}
          placeholder="Ask Cala AI…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
        />
        <button type="submit" disabled={working || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
