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
};

function describe(a: ChatAction): string {
  const input = a.input as Record<string, unknown>;
  const detail = input.query ?? input.name ?? (input.cell !== undefined ? `cell ${input.cell}` : input.type) ?? "";
  return `${ACTION_LABEL[a.tool] ?? a.tool}${detail ? `: ${String(detail)}` : ""}${a.error ? " (failed)" : ""}`;
}

/** Chat with Claude, docked bottom right. Claude edits the analysis through tools; the page shows the result. */
export function Chat({ id, onAnalysis }: { id: string; onAnalysis: (a: Analysis) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, working]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
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
        Ask Claude
      </button>
    );
  }
  return (
    <aside className="chat" aria-label="Chat with Claude">
      <header>
        <strong>Claude</strong>
        <span>
          <button type="button" className="link" onClick={reset} disabled={working}>New chat</button>{" "}
          <button type="button" className="link" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
        </span>
      </header>
      <div className="chat-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <p className="muted">Ask for an analysis, e.g. "Chart fintech companies by country" or "Why is cell 5 empty?". Claude runs Cala queries and adds cells for you.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.actions && m.actions.length > 0 && (
              <ul className="actions">{m.actions.map((a, j) => <li key={j}>{describe(a)}</li>)}</ul>
            )}
            <p>{m.text}</p>
          </div>
        ))}
        {working && <p className="muted" role="status">Claude is working. New Cala queries take up to a minute each…</p>}
      </div>
      <form onSubmit={send}>
        <textarea
          rows={2}
          aria-label="Message"
          value={text}
          placeholder="Ask Claude…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
        />
        <button type="submit" disabled={working || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
