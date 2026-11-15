import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Suggestions } from "../../shared/types.ts";
import { api, cachedView } from "./api.ts";

let shared: Promise<Suggestions> | undefined;
let complete = false;
/** Fetched once per page; asked again (on the next focus) only while the server's schema is still incomplete. */
const loadSuggestions = () => {
  if (!shared || !complete) {
    const fresh = api.suggestions();
    // The client cache answers at once (works offline too); the server refreshes it once per page load.
    const cached = cachedView.suggestions();
    shared = cached ? Promise.resolve(cached) : fresh.catch(() => ({ entities: [], fields: [] }));
    fresh.then((s) => { complete = Object.keys(s.schema ?? {}).length >= 4; shared = Promise.resolve(s); }).catch(() => {});
  }
  return shared;
};

/** Query text with each {{param}} wrapped as a chip. Keeps every character, so it lines up with the textarea. */
function chips(text: string) {
  return text.split(/(\{\{\s*\w+\s*\}\})/g).map((part, i) => {
    const m = /^(\{\{\s*)(\w+)(\s*\}\})$/.exec(part);
    if (!m) return part;
    return (
      <mark key={i} className="param-chip">
        <span className="brace">{m[1]}</span>{m[2]}<span className="brace">{m[3]}</span>
      </mark>
    );
  });
}

export interface Item {
  text: string; // inserted
  hint?: string; // shown next to it
  path?: string; // shown in italics before the hint, e.g. "company.name"
}

/** The entity type at the end of a dot path: "companies.founders." is on Person. */
/** Entity words Cala understands anywhere in a path, e.g. "Location={{location}}.companies". */
const ENTITY_WORDS: Record<string, string> = { companies: "Company", people: "Person" };

export function typeAt(s: Suggestions, path: string): string | undefined {
  const raw = path.split(".");
  const segments = raw.map((seg) => /^\s*([\w ]+?)\s*(?:[=!<>(]|$)/.exec(seg)?.[1]?.toLowerCase() ?? "");
  let type = s.aliases?.[segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const rel = type ? s.schema?.[type]?.relations.find((r) => r.word === seg) : undefined;
    if (rel) type = rel.type; // stepping into a related entity
    // A bare entity word mid-path ("Location=Helsinki.companies") also steps in: Cala resolves that link itself.
    // A filter ("location=Finland") or a property keeps the type.
    else if (/^\s*[\w ]+\s*$/.test(raw[i]) && ENTITY_WORDS[seg]) type = ENTITY_WORDS[seg];
  }
  return type;
}

/** Words to offer for the text left of the cursor. */
export function options(s: Suggestions, text: string): { word: string; items: Item[] } {
  // After "field=" (or "field!="): offer values Cala has shown for that field. The value may contain spaces.
  const valueAt = /(?:^|\.)\s*(\w+)\s*!?=([^.=()]*)$/.exec(text);
  if (valueAt && !valueAt[2].includes("{{")) {
    const known = s.values?.[valueAt[1].toLowerCase()] ?? s.values?.[valueAt[1]] ?? [];
    const typed = valueAt[2].trimStart();
    const want = typed.toLowerCase();
    const items = known
      .filter((v) => v.toLowerCase().includes(want) && v !== typed)
      .sort((a, b) => Number(!a.toLowerCase().startsWith(want)) - Number(!b.toLowerCase().startsWith(want)))
      .slice(0, 30)
      .map((v) => ({ text: v, hint: "seen in Cala" }));
    if (items.length) return { word: typed, items };
  }
  const word = /\w*$/.exec(text)![0];
  const before = text.slice(0, text.length - word.length);
  const inReturn = before.lastIndexOf("return(") > before.lastIndexOf(")");
  let pool: Item[] = [];
  if (before.trim() === "") {
    pool = s.entities.map((e) => ({ text: e, hint: s.aliases?.[e.toLowerCase()] && s.schema?.[s.aliases[e.toLowerCase()]] ? "entity" : undefined }));
  } else if (inReturn || before.endsWith(".")) {
    const path = inReturn ? before.slice(0, before.lastIndexOf(".return(")) : before.slice(0, -1);
    const type = typeAt(s, path);
    const schema = type ? s.schema?.[type] : undefined;
    pool = [
      // Tested paths first, then the other relationships, then properties.
      ...(!inReturn && schema
        ? [...schema.relations]
          .sort((a, b) => Number(Boolean(b.tested)) - Number(Boolean(a.tested)))
          .map((r) => ({
            text: r.word,
            hint: `→ ${r.type ?? "related"}${r.tested ? " · tested" : ""}${r.examples?.length ? ` · e.g. ${r.examples.slice(0, 2).join(", ")}` : ` · ${r.rel}`}`,
          }))
        : []),
      ...(!inReturn
        ? Object.entries(ENTITY_WORDS).map(([text, to]) => ({ text, hint: `→ ${to} · Cala resolves the link` }))
        : []),
      ...(schema ? schema.properties.map((p) => ({ text: p, hint: `${type} property` })) : []),
      // Fields Cala has returned before: where they sit (entity.property) and how to ask for them.
      ...s.fields.map((f) => ({ text: f, path: `${(type ?? "entity").toLowerCase()}.${f}`, hint: `.return(${f})` })),
      ...(inReturn ? [] : [{ text: "limit=" }, { text: "order_by=" }, { text: "return(" }]),
    ];
  }
  // Match anywhere in the word ("companie" finds headquartered_companies); words that start with it come first.
  const w = word.toLowerCase();
  const seen = new Set<string>();
  const items = pool.filter((o) => {
    if (seen.has(o.text) || !o.text.toLowerCase().includes(w) || o.text === word) return false;
    seen.add(o.text);
    return true;
  });
  const starts = items.filter((o) => o.text.toLowerCase().startsWith(w));
  return { word, items: [...starts, ...items.filter((o) => !starts.includes(o))].slice(0, 80) };
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function QueryBox({ id, value, onChange, label }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [s, setS] = useState<Suggestions>({ entities: [], fields: [] });
  const [open, setOpen] = useState<{ word: string; items: Item[] }>({ word: "", items: [] });
  const [active, setActive] = useState(0);
  const listId = `${id}-list`;

  useEffect(() => {
    loadSuggestions().then(setS);
  }, []);
  const refresh = () => loadSuggestions().then(setS); // picks up the schema once the server has built it

  const update = (text: string, cursor: number) => {
    setOpen(options(s, text.slice(0, cursor)));
    setActive(0);
  };

  const pick = (i: number) => {
    const el = box.current!;
    const end = el.selectionStart;
    const start = end - open.word.length;
    const text = open.items[i].text;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    const cursor = start + text.length;
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = cursor;
      update(next, cursor);
    });
  };

  // Grow with the text: no scrollbar, so the chip layer behind always wraps exactly like the textarea.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const shown = open.items.length > 0;
  return (
    <div className="querybox">
      {/* Same text drawn behind the (transparent-text) textarea, with {{params}} as chips. */}
      <div className="query-mirror" aria-hidden="true">{chips(value)}{"\n"}</div>
      <textarea
        ref={box}
        id={id}
        className="query-input"
        name="query"
        rows={2}
        aria-label={label}
        value={value}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          update(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => update(value, e.currentTarget.selectionStart)}
        onFocus={refresh}
        onBlur={() => setOpen({ word: "", items: [] })}
        onKeyDown={(e) => {
          // A chip is one unit: Backspace right after it, or Delete right before it, removes the whole {{param}}.
          const el = e.currentTarget;
          if ((e.key === "Backspace" || e.key === "Delete") && el.selectionStart === el.selectionEnd) {
            const at = el.selectionStart;
            const token = e.key === "Backspace"
              ? /\{\{\s*\w+\s*\}\}$/.exec(value.slice(0, at))?.[0]
              : /^\{\{\s*\w+\s*\}\}/.exec(value.slice(at))?.[0];
            if (token) {
              e.preventDefault();
              const start = e.key === "Backspace" ? at - token.length : at;
              const next = value.slice(0, start) + value.slice(start + token.length);
              onChange(next);
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start; });
              return;
            }
          }
          if (!shown) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((active + (e.key === "ArrowDown" ? 1 : open.items.length - 1)) % open.items.length);
          } else if (e.key === "Tab" || e.key === "Enter") {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape") {
            setOpen({ word: "", items: [] });
          }
        }}
      />
      {shown && (
        <ul className="suggest" role="listbox" id={listId}>
          {open.items.map((item, i) => (
            <li
              key={item.text}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              ref={(el) => { if (i === active) el?.scrollIntoView({ block: "nearest" }); }}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              <span>{item.text}</span>
              {(item.path || item.hint) && (
                <span className="suggest-hint">
                  {item.path && <i>{item.path}</i>}
                  {item.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
