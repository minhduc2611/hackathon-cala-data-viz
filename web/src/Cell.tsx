import { useId, useState } from "react";
import { joinValues, type Selection } from "../../shared/selection.ts";
import { DEFAULTS, FIELDS, OPS, TESTS, type Board, type Row, type Run, type Step } from "../../shared/types.ts";
import { ChartView } from "./ChartView.tsx";
import { drill } from "./drill.ts";
import { GraphView } from "./GraphView.tsx";
import { Icon } from "./Icon.tsx";
import { NoteText } from "./NoteText.tsx";
import { QueryBox } from "./QueryBox.tsx";
import { Table } from "./Table.tsx";
import { Verdict } from "./Verdict.tsx";

const LABELS: Record<string, string> = {
  column: "Column", op: "Op", value: "Value", group: "Group by", fn: "Function", metric: "Metric column",
  kind: "Type", x: "X column", y: "Y column", text: "Note", other: "Join with source", on: "On column",
  name: "Source name", query: "Cala query", sep: "Separator", order: "Order", source: "From column", target: "To column",
  claim: "Claim", test: "Test", tolerance: "Tolerance %",
};
const CHOICES: Record<string, readonly string[]> = { op: OPS, fn: ["count", "sum", "avg"], kind: ["bar", "line"], order: ["desc", "asc"], test: TESTS };
const COLUMN_FIELDS = new Set(["column", "group", "metric", "x", "y", "on", "source", "target"]);
const columnsOf = (rows: Row[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const Gear = () => (
  <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const Tick = () => (
  <Glyph>
    <path d="M2.8 8.2 6.2 12 13.2 4" />
  </Glyph>
);
const Trash = () => (
  <Glyph>
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M3.6 4.5l.6 8.5h7.6l.6-8.5M6.6 7v4M9.4 7v4" />
  </Glyph>
);
// A cell still on its defaults has nothing to show, so it opens as a form. Anything filled opens as chips.
const untouched = (board: Board) => FIELDS[board.type].every((field) => {
  const value = board[field] ?? "";
  return value === "" || value === DEFAULTS[field];
});

interface Props {
  number: number;
  step: Step;
  run: Run;
  busy: boolean;
  onSave: (board: Board) => void;
  onDelete: () => void;
  onInsert: (board: Board, at: number) => void;
  onSelect: (selection: Selection | null) => void;
}

export function Cell({ number, step, run, busy, onSave, onDelete, onInsert, onSelect }: Props) {
  const uid = useId();
  const [board, setBoard] = useState<Board>(step.board);
  const [editing, setEditing] = useState(() => untouched(step.board));
  const set = (field: string, value: string) => setBoard({ ...board, [field]: value });
  const type = board.type;
  const showRows = (type === "filter" || type === "aggregate" || type === "split" || type === "sort" || type === "join" || (type === "query" && step.resolved)) && !step.error;

  return (
    <section className={`board ${type}`}>
      <h3 className="cell-title"><Icon name={type} /> [{number}] {type}{step.name ? ` · ${step.name}` : ""}</h3>
      <datalist id={`${uid}cols`}>{step.columns.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id={`${uid}src`}>{step.sources.map((s) => <option key={s} value={s} />)}</datalist>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); setEditing(false); onSave(board); }}>
          {FIELDS[type].map((field) => {
            const value = board[field] ?? "";
            if (field === "text") return <textarea key={field} rows={2} aria-label="Note" value={value} onChange={(e) => set(field, e.target.value)} />;
            if (field === "query") return <QueryBox key={field} id={`${uid}q`} label="Cala query" value={value} onChange={(v) => set(field, v)} />;
            return (
              <label key={field}>
                {LABELS[field]}{" "}
                {CHOICES[field] ? (
                  <select value={value} onChange={(e) => set(field, e.target.value)}>
                    {CHOICES[field].map((c) => <option key={c}>{c}</option>)}
                  </select>
                ) : (
                  <input
                    value={value}
                    placeholder={field === "name" ? step.name : undefined}
                    list={COLUMN_FIELDS.has(field) ? `${uid}cols` : field === "other" ? `${uid}src` : undefined}
                    onChange={(e) => set(field, e.target.value)}
                  />
                )}
              </label>
            );
          })}
          <span className="cell-actions">
            <button type="submit" disabled={busy} aria-label="Save" title="Save"><Tick /></button>{" "}
            <button type="button" className="quiet" disabled={busy} aria-label="Delete" title="Delete" onClick={onDelete}><Trash /></button>
          </span>
        </form>
      ) : (
        <div className="cell-summary">
          {FIELDS[type].map((field) => {
            const value = (board[field] ?? "").trim();
            if (!value) return null;
            return (
              <span key={field} className="field-chip" title={value}>
                <span className="field-chip-label">{LABELS[field]}</span>
                <b>{value}</b>
              </span>
            );
          })}
          <span className="cell-actions">
            <button type="button" disabled={busy} aria-label="Edit" title="Edit" onClick={() => setEditing(true)}><Gear /></button>{" "}
            <button type="button" className="quiet" disabled={busy} aria-label="Delete" title="Delete" onClick={onDelete}><Trash /></button>
          </span>
        </div>
      )}
      {step.error && <p className="error">{step.error}</p>}
      {step.info && <p className="muted">{step.info}</p>}
      {step.resolved && !step.error && <p className="muted">{step.resolved}</p>}
      {showRows && <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />}
      {step.selection && <p className="selected-tag">Showing only {step.selection} (interactive selection)</p>}
      {step.chart && <ChartTabs step={step} run={run} index={number - 2} onSelect={onSelect} onFilter={busy ? undefined : onInsert} />}
      {step.check && <Verdict check={step.check} />}
      {step.graph && <GraphView graph={step.graph} />}
      {type === "note" && step.text && <NoteText text={step.text} />}
    </section>
  );
}

interface ChartTabsProps {
  step: Step;
  run: Run;
  index: number; // step index of this chart
  onSelect: (selection: Selection | null) => void; // interactive selection: re-runs the cells below
  onFilter?: (board: Board, at: number) => void; // editor only: make the selection a permanent filter
}

export function ChartTabs({ step, run, index, onSelect, onFilter }: ChartTabsProps) {
  const uid = useId();
  const [tab, setTab] = useState<"chart" | "table">("chart");
  const picked = step.chart!.selected ?? [];
  // Plain click: select only this bar (click it again to clear). Shift / Cmd / Ctrl click: add or remove it.
  const setPicked = (label: string, add: boolean) => {
    const next = add
      ? picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]
      : picked.length === 1 && picked[0] === label ? [] : [label];
    onSelect(next.length ? { step: index, labels: next } : null);
  };
  const detail = picked.length ? drill(run, index, picked) : null;
  const pickedText = picked.map((l) => `“${l}”`).join(", ");
  const filterValue = picked.length === 1 ? picked[0] : joinValues(picked);
  const tabs = ["chart", "table"] as const;
  const keyNav = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = tab === "chart" ? "table" : "chart";
    setTab(next);
    document.getElementById(`${uid}tab-${next}`)?.focus();
  };
  return (
    <>
      <div className="tabs" role="tablist" aria-label="View">
        {tabs.map((t) => (
          <button
            key={t} type="button" role="tab" id={`${uid}tab-${t}`} aria-controls={`${uid}panel-${t}`}
            aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={keyNav}
          >
            {t === "chart" ? "Chart" : "Table"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}panel-chart`} aria-labelledby={`${uid}tab-chart`} hidden={tab !== "chart"}>
        <ChartView chart={step.chart!} label={`${step.chart!.kind} chart of ${step.board.y} by ${step.board.x}`} onPick={setPicked} />
      </div>
      <div role="tabpanel" id={`${uid}panel-table`} aria-labelledby={`${uid}tab-table`} hidden={tab !== "table"}>
        <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />
      </div>
      {detail && (
        <div className="drill" role="region" aria-label={`Rows behind ${pickedText}`}>
          <div className="drill-head">
            <strong>{detail.rows.length} row{detail.rows.length === 1 ? "" : "s"} behind {pickedText}</strong>
            <span>
              {onFilter && (
                <>
                  <button
                    type="button"
                    onClick={() => onFilter({ type: "filter", column: detail.column, op: picked.length === 1 ? "=" : "is one of", value: filterValue }, detail.insertAt)}
                  >
                    Keep only
                  </button>{" "}
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => onFilter({ type: "filter", column: detail.column, op: picked.length === 1 ? "!=" : "is not one of", value: filterValue }, detail.insertAt)}
                  >
                    Remove
                  </button>{" "}
                </>
              )}
              <button type="button" className="link" onClick={() => onSelect(null)}>Clear selection</button>
            </span>
          </div>
          {onFilter && (
            <p className="muted">
              This selection is temporary. Keep only / Remove saves it as a filter on {detail.column} at cell {detail.insertAt + 2}
              {detail.aggregated ? ", before the aggregate this chart is built from, so every cell below follows it." : ", right after this chart."}
            </p>
          )}
          {detail.capped && <p className="muted">Taken from the first rows shown for the cell above; the full set may hold more.</p>}
          <Table rows={detail.rows} columns={columnsOf(detail.rows)} total={detail.rows.length} />
        </div>
      )}
    </>
  );
}
