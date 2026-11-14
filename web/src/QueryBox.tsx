import { useEffect, useRef, useState } from "react";
import type { Suggestions } from "../../shared/types.ts";
import { api } from "./api.ts";

let shared: Promise<Suggestions> | undefined;
const loadSuggestions = () => (shared ??= api.suggestions().catch(() => ({ entities: [], fields: [] })));

/** Words to offer for the text left of the cursor. */
export function options(s: Suggestions, text: string): { word: string; items: string[] } {
  const word = /\w*$/.exec(text)![0];
  const before = text.slice(0, text.length - word.length);
  let pool: string[] = [];
  if (before.lastIndexOf("return(") > before.lastIndexOf(")")) pool = s.fields;
  else if (before.trim() === "") pool = s.entities;
  else if (before.endsWith(".")) pool = [...s.fields, "limit=", "order_by=", "return("];
  const w = word.toLowerCase();
  return { word, items: pool.filter((o) => o.toLowerCase().startsWith(w) && o !== word).slice(0, 60) };
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
  const [open, setOpen] = useState<{ word: string; items: string[] }>({ word: "", items: [] });
  const [active, setActive] = useState(0);
  const listId = `${id}-list`;

  useEffect(() => {
    loadSuggestions().then(setS);
  }, []);

  const update = (text: string, cursor: number) => {
    setOpen(options(s, text.slice(0, cursor)));
    setActive(0);
  };

  const pick = (i: number) => {
    const el = box.current!;
    const end = el.selectionStart;
    const start = end - open.word.length;
    const next = value.slice(0, start) + open.items[i] + value.slice(end);
    onChange(next);
    const cursor = start + open.items[i].length;
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = cursor;
      update(next, cursor);
    });
  };

  const shown = open.items.length > 0;
  return (
    <div className="querybox">
      <textarea
        ref={box}
        id={id}
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
        onBlur={() => setOpen({ word: "", items: [] })}
        onKeyDown={(e) => {
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
              key={item}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              ref={(el) => { if (i === active) el?.scrollIntoView({ block: "nearest" }); }}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
