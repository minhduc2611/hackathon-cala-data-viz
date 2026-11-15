// Renders the markdown Claude writes in chat replies: paragraphs, - and 1. lists, # headings, **bold**, *italic*, `code`.
// Builds React elements (no HTML injection), so model text can never become markup.
import type { ReactNode } from "react";

type Block = { kind: "p"; lines: string[] } | { kind: "h"; lines: string[] } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^#{1,6}\s+/;

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split("\n")) {
    const last = out.at(-1);
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }); // blank line ends the block
    } else if (HEADING.test(line)) {
      out.push({ kind: "h", lines: [line.replace(HEADING, "")] });
    } else if (BULLET.test(line) || NUMBER.test(line)) {
      const kind = BULLET.test(line) ? "ul" : "ol";
      const item = line.replace(kind === "ul" ? BULLET : NUMBER, "");
      if (last?.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if ((last?.kind === "ul" || last?.kind === "ol") && /^\s+/.test(line)) {
      last.items[last.items.length - 1] += " " + line.trim(); // indented continuation of a list item
    } else if (last?.kind === "p" && last.lines.length) {
      last.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => ("lines" in b ? b.lines.length : b.items.length));
}

/** **bold**, *italic* / _italic_, `code`; anything unmatched stays as typed. */
export function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\b_[^_]+_\b)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^(\*[^*].*\*|_.+_)$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        if (b.kind === "ul") return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
        if (b.kind === "ol") return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>;
        if (b.kind === "h") return <p key={i}><strong>{inline(b.lines[0])}</strong></p>;
        return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </div>
  );
}
