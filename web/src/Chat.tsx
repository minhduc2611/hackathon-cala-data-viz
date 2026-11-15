import { useEffect, useRef, useState } from "react";
import type { Analysis, ChatAction, ChatEvent } from "../../shared/types.ts";
import { api } from "./api.ts";

/** What Claude did on the way to its reply, in order: its words between tool calls, and each tool call. */
type Step = { kind: "text"; text: string } | { kind: "action"; action: ChatAction };

interface Message {
  role: "user" | "claude" | "error";
  text: string;
  steps?: Step[];
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

function describe(a: ChatAction): string {
  const input = a.input as Record<string, unknown>;
  const args = input.arguments as Record<string, unknown> | undefined;
  const detail = input.query ?? input.name ?? input.section ?? (input.tool ? `${input.tool}${args?.input ? ` "${args.input}"` : ""}` : undefined)
    ?? (input.cell !== undefined ? `cell ${input.cell}` : input.type) ?? "";
  return `${ACTION_LABEL[a.tool] ?? a.tool}${detail ? `: ${String(detail)}` : ""}`;
}

function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <ul className="actions">
      {steps.map((s, j) => s.kind === "text"
        ? <li key={j} className="said">{s.text}</li>
        : (
          <li key={j} className={s.action.error ? "failed" : undefined}>
            {describe(s.action)}
            <span className="result">{s.action.result === undefined ? " … running" : ` → ${s.action.result}`}</span>
          </li>
        ))}
    </ul>
  );
}

/** Adds one streamed event to the live steps. A result replaces the latest still-running call. */
function addEvent(steps: Step[], e: ChatEvent): Step[] {
  if (e.type === "text") return [...steps, { kind: "text", text: e.text }];
  if (e.type === "call") return [...steps, { kind: "action", action: e.action }];
  if (e.type === "result") {
    const i = steps.findLastIndex((s) => s.kind === "action" && s.action.result === undefined);
    if (i >= 0) return steps.map((s, j) => (j === i ? { kind: "action", action: e.action } : s));
  }
  return steps;
}

/** Chat with Cala AI, docked bottom right. It edits the analysis through tools; the page shows the result. */
export function Chat({ id, onAnalysis }: { id: string; onAnalysis: (a: Analysis) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [live, setLive] = useState<{ round: number; steps: Step[] }>({ round: 0, steps: [] });
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, working, live]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || working) return;
    setText("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setWorking(true);
    // A report can take minutes: show each step as the server streams it, and redraw the page on every edit.
    let steps: Step[] = [];
    let round = 0;
    setLive({ round, steps });
    try {
      const reply = await api.chat(id, message, (e) => {
        if (e.type === "round") round = e.round;
        if (e.type === "analysis") onAnalysis(e.analysis);
        steps = addEvent(steps, e);
        setLive({ round, steps });
      });
      setMessages((m) => [...m, { role: "claude", text: reply.reply, steps }]);
      onAnalysis(reply.analysis);
    } catch (err) {
      setMessages((m) => [...m, ...(steps.length ? [{ role: "claude" as const, text: "", steps }] : []), { role: "error", text: (err as Error).message }]);
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
          <p className="muted">Ask for an analysis, e.g. "Chart fintech companies by country" or "Why is cell 5 empty?". Cala AI runs queries and adds cells for you.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.steps && <Steps steps={m.steps} />}
            {m.text && <p>{m.text}</p>}
          </div>
        ))}
        {working && (
          <div className="msg claude" role="status">
            <Steps steps={live.steps} />
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
