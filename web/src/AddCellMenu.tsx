import { useEffect, useId, useRef, useState } from "react";
import { BOARD_TYPES, type BoardType } from "../../shared/types.ts";
import { Icon } from "./Icon.tsx";

type Item = BoardType | "ainote";
const GROUPS: { label: string; types: Item[] }[] = [
  { label: "Data", types: ["query", "join"] },
  { label: "Transform", types: ["filter", "aggregate", "split", "sort"] },
  { label: "Visualize", types: ["chart", "graph"] },
  { label: "Explain", types: ["note", "check", "ainote"] },
];
// Every cell type must be in a group; this fails loudly in development if one is added without a group.
console.assert(BOARD_TYPES.every((t) => GROUPS.some((g) => g.types.includes(t))), "A cell type is missing from the add-cell menu");

const DESCRIBE: Record<Item, string> = {
  query: "Start a new source from another Cala query",
  join: "Add columns from an earlier source",
  filter: "Keep only the rows that match",
  aggregate: "Group rows; count, sum or average",
  split: "One row per list item, e.g. each investor",
  sort: "Order rows by a column",
  chart: "Bar or line chart of the rows here",
  graph: "Network of two columns, e.g. company ↔ investor",
  note: "Write the story or insight",
  check: "Compare a claimed number or name with the data",
  ainote: "Stories, insights and findings from the cells above. Rewrites when their data changes",
};

const Spark = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2 2M10.6 10.6l2 2M12.6 3.4l-2 2M5.4 10.6l-2 2" />
  </svg>
);

/** "+ Add cell" button with a grouped popover menu. */
export function AddCellMenu({ disabled, onAdd }: { disabled: boolean; onAdd: (type: Item) => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false); // open above the button when there is no room below
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const order = GROUPS.flatMap((g) => g.types);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const outside = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = items.current.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => { e.preventDefault(); items.current[(i + order.length) % order.length]?.focus(); };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(order.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
  };

  return (
    <div className="add-cell" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="add-cell-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          const r = trigger.current!.getBoundingClientRect();
          setUp(innerHeight - r.bottom < 380 && r.top > innerHeight - r.bottom);
          setOpen(!open);
        }}
      >
        <span aria-hidden="true" className="plus">+</span> Add cell
      </button>
      {open && (
        <div className={`add-cell-menu${up ? " up" : ""}`} role="menu" id={menuId} aria-label="Add a cell" onKeyDown={onKeyDown}>
          {GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="add-cell-group">
              <span className="add-cell-group-label" aria-hidden="true">{group.label}</span>
              {group.types.map((type) => (
                <button
                  key={type}
                  ref={(el) => { items.current[order.indexOf(type)] = el; }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="add-cell-item"
                  onClick={() => { close(); onAdd(type); }}
                >
                  <span className="add-cell-icon">{type === "ainote" ? <Spark /> : <Icon name={type} />}</span>
                  <span>
                    <span className="add-cell-name">{type === "ainote" ? "AI note" : type}</span>
                    <span className="add-cell-desc">{DESCRIBE[type]}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
