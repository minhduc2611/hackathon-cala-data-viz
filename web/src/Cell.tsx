import { useId, useState } from "react";
import { FIELDS, OPS, TESTS, type Board, type Step } from "../../shared/types.ts";
import { ChartView } from "./ChartView.tsx";
import { QueryBox } from "./QueryBox.tsx";
import { Table } from "./Table.tsx";
import { Verdict } from "./Verdict.tsx";

const LABELS: Record<string, string> = {
  column: "Column", op: "Op", value: "Value", group: "Group by", fn: "Function", metric: "Metric column",
  kind: "Type", x: "X column", y: "Y column", text: "Note", other: "Join with source", on: "On column",
  name: "Source name", query: "Cala query", sep: "Separator", order: "Order",
  claim: "Claim", test: "Test", tolerance: "Tolerance %",
};
const CHOICES: Record<string, readonly string[]> = { op: OPS, fn: ["count", "sum", "avg"], kind: ["bar", "line"], order: ["desc", "asc"], test: TESTS };
const COLUMN_FIELDS = new Set(["column", "group", "metric", "x", "y", "on"]);

interface Props {
  number: number;
  step: Step;
  busy: boolean;
  onSave: (board: Board) => void;
  onDelete: () => void;
}

export function Cell({ number, step, busy, onSave, onDelete }: Props) {
  const uid = useId();
  const [board, setBoard] = useState<Board>(step.board);
  const set = (field: string, value: string) => setBoard({ ...board, [field]: value });
  const type = board.type;
  const showRows = (type === "filter" || type === "aggregate" || type === "split" || type === "sort" || type === "join" || (type === "query" && step.resolved)) && !step.error;

  return (
    <section className={`board ${type}`}>
      <h3>[{number}] {type}{step.name ? ` · ${step.name}` : ""}</h3>
      <datalist id={`${uid}cols`}>{step.columns.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id={`${uid}src`}>{step.sources.map((s) => <option key={s} value={s} />)}</datalist>
      <form onSubmit={(e) => { e.preventDefault(); onSave(board); }}>
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
        <button type="submit" disabled={busy}>Save</button>{" "}
        <button type="button" className="quiet" disabled={busy} onClick={onDelete}>Delete</button>
      </form>
      {step.error && <p className="error">{step.error}</p>}
      {step.info && <p className="muted">{step.info}</p>}
      {step.resolved && !step.error && <p className="muted">{step.resolved}</p>}
      {showRows && <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />}
      {step.chart && <ChartTabs step={step} />}
      {step.check && <Verdict check={step.check} />}
      {type === "note" && step.text && <p className="story">{step.text}</p>}
    </section>
  );
}

export function ChartTabs({ step }: { step: Step }) {
  const uid = useId();
  const [tab, setTab] = useState<"chart" | "table">("chart");
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
        <ChartView chart={step.chart!} label={`${step.chart!.kind} chart of ${step.board.y} by ${step.board.x}`} />
      </div>
      <div role="tabpanel" id={`${uid}panel-table`} aria-labelledby={`${uid}tab-table`} hidden={tab !== "table"}>
        <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />
      </div>
    </>
  );
}
