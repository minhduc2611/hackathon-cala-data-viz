import { useEffect, useState } from "react";
import type { Selection } from "../../shared/selection.ts";
import type { Analysis, Board } from "../../shared/types.ts";
import { api, cachedView } from "./api.ts";
import { ChartTabs } from "./Cell.tsx";
import { Table } from "./Table.tsx";
import { GraphView } from "./GraphView.tsx";
import { NoteText } from "./NoteText.tsx";
import { Verdict } from "./Verdict.tsx";

const fill = (text: string, params: Record<string, string>) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => params[name] || name);

const DATA_CELLS = new Set(["filter", "aggregate", "split", "sort", "join"]);

/** A heading for a result table, from the cell that produced it. */
function describe(board: Board, params: Record<string, string>): string {
  const b = Object.fromEntries(Object.entries(board).map(([k, v]) => [k, fill(v, params).replaceAll("_", " ")]));
  if (board.type === "filter") return `Rows where ${b.column} ${b.op} ${b.value ?? ""}`.trim();
  if (board.type === "aggregate") return b.fn === "count" ? `Count by ${b.group}` : `${b.fn} of ${b.metric} by ${b.group}`;
  if (board.type === "join") return `Joined with ${b.other} on ${b.on}`;
  if (board.type === "sort") return `Sorted by ${b.column}`;
  return `One row per ${b.column}`;
}

/** Read-only report: parameters on top, then only the charts and story notes. Runs never save. */
export function Report({ id, initial }: { id: string; initial: Record<string, string> }) {
  const [data, setData] = useState<Analysis | null>(null);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);

  async function run(params: Record<string, string>, sel: Selection | null = null) {
    setBusy(true);
    setError("");
    // A report seen before (same values, same selection) shows at once; the server's answer then replaces it.
    const cached = cachedView.play(id, params, sel);
    if (cached) {
      setData(cached);
      setSelection(sel);
    }
    try {
      const next = await api.play(id, params, sel);
      setData(next);
      setSelection(sel);
      setValues({ ...next.template.params, ...params });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    run(initial);
  }, [id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // The values live in the link, so a report for other values can be bookmarked or shared.
    history.replaceState(null, "", `#/r/${id}?${new URLSearchParams(values)}`);
    run(values); // new values: the old selection may not exist any more
  }

  // Interactive: clicking a bar re-runs the report with that selection applied to everything below it.
  const select = (sel: Selection | null) => run(data?.template.params ?? values, sel);

  if (!data) {
    return (
      <main>
        <p><a href={`#/a/${id}`}>← Edit template</a></p>
        {error ? <p className="error">{error}</p> : <p className="muted">Building the report…</p>}
      </main>
    );
  }

  const params = data.template.params;
  const hints = data.template.paramHints ?? {};
  const saved = data.savedParams ?? params;
  const changed = data.paramNames.filter((p) => (params[p] ?? "") !== (saved[p] ?? ""));
  const writtenFor = data.paramNames.map((p) => `${p} = ${saved[p] ?? ""}`).join(", ");
  return (
    <main className="report" aria-busy={busy}>
      <p className="topbar">
        <a href={`#/a/${id}`}>← Edit template</a>
      </p>
      <h1>{fill(data.template.name, params)}</h1>

      {data.paramNames.length > 0 && (
        <form className="params" onSubmit={submit}>
          {data.paramNames.map((p) => (
            <label key={p}>
              <span className="label-chip">{p}</span>
              <input value={values[p] ?? ""} onChange={(e) => setValues({ ...values, [p]: e.target.value })} aria-describedby={hints[p] ? `hint-${p}` : undefined} />
              {hints[p] && <small id={`hint-${p}`}>{hints[p]}</small>}
            </label>
          ))}
          <button type="submit" disabled={busy}>{busy ? "Running…" : "Run report"}</button>
        </form>
      )}
      {busy && <p className="muted" role="status">Running. New values mean new Cala queries, up to a minute…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {data.run.error && <p className="error">Main query: {data.run.error}</p>}
      {selection && data.run.steps[selection.step]?.chart?.selected && (
        <div className="selection-bar" role="status">
          <span>
            Selected <b>{selection.labels.join(", ")}</b> in cell {selection.step + 2}. Charts and tables below it show only that.
            {selection.labels.length === 1 && <span className="muted"> Shift- or ⌘-click to add more.</span>}
          </span>
          <button type="button" className="quiet" onClick={() => select(null)} disabled={busy}>Clear selection</button>
        </div>
      )}

      {data.run.steps.map((step, i) => {
        const cell = <span className="muted cellno">cell {i + 2}</span>;
        if (step.check) {
          return (
            <section className="board" key={i} aria-label={`Claim check: ${step.check.claim}`}>
              <Verdict check={step.check} />
            </section>
          );
        }
        if (step.graph) {
          return (
            <section className="board" key={i}>
              <h2>{`${step.graph.source} ↔ ${step.graph.target} network`.replaceAll("_", " ")} {cell}</h2>
              {step.selection && <p className="selected-tag">Showing only {step.selection}</p>}
              {step.info && <p className="muted">{step.info}</p>}
              <GraphView graph={step.graph} />
            </section>
          );
        }
        if (step.chart) {
          return (
            <section className="board" key={i}>
              <h2>{`${step.board.y} by ${step.board.x}`.replaceAll("_", " ")} {cell}</h2>
              {step.info && <p className="muted">{step.info}</p>}
              {step.selection && <p className="selected-tag">Showing only {step.selection}</p>}
              <ChartTabs step={step} run={data.run} index={i} onSelect={select} />
            </section>
          );
        }
        // A data cell that ends a section (next is a query, the story, or nothing) is that section's result list.
        const next = data.run.steps[i + 1]?.board.type;
        const endsSection = !next || next === "query" || next === "note";
        if (endsSection && DATA_CELLS.has(step.board.type) && !step.error) {
          return (
            <section className="board" key={i}>
              <h2>{describe(step.board, params)} {cell}</h2>
              {step.selection && <p className="selected-tag">Showing only {step.selection}</p>}
              <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />
            </section>
          );
        }
        if (step.board.type === "note" && (step.text || step.error)) {
          const written = step.board.ai === "1";
          return (
            <section className="board note" key={i}>
              {changed.length > 0 && !written && (
                <p className="stale" role="note">
                  This text was written for {writtenFor}. The charts above are live for your values; the numbers in this text are not.
                </p>
              )}
              {step.error && <p className="error">{step.error}</p>}
              {step.text && <NoteText text={step.text} />}
            </section>
          );
        }
        if (step.error && step.board.type !== "note") {
          return <p className="error" key={i}>Cell {i + 2} ({step.board.type}): {step.error}</p>;
        }
        return null;
      })}
    </main>
  );
}
