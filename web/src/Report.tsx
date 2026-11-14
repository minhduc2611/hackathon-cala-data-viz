import { useEffect, useState } from "react";
import type { Analysis, Board } from "../../shared/types.ts";
import { api } from "./api.ts";
import { ChartTabs } from "./Cell.tsx";
import { Table } from "./Table.tsx";

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

  async function run(params: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const next = await api.play(id, params);
      setData(next);
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
    run(values);
  }

  if (!data) {
    return (
      <main>
        <p><a href={`#/a/${id}`}>← Edit template</a></p>
        {error ? <p className="error">{error}</p> : <p className="muted">Building the report…</p>}
      </main>
    );
  }

  const params = data.template.params;
  const saved = data.savedParams ?? params;
  const changed = data.paramNames.filter((p) => (params[p] ?? "") !== (saved[p] ?? ""));
  const writtenFor = data.paramNames.map((p) => `${p} = ${saved[p] ?? ""}`).join(", ");
  return (
    <main className="report" aria-busy={busy}>
      <p className="topbar">
        <a href={`#/a/${id}`}>← Edit template</a>
        <a href="#/">All templates</a>
      </p>
      <h1>{fill(data.template.name, params)}</h1>

      {data.paramNames.length > 0 && (
        <form className="params" onSubmit={submit}>
          {data.paramNames.map((p) => (
            <label key={p}>
              <span>{p}</span>
              <input value={values[p] ?? ""} onChange={(e) => setValues({ ...values, [p]: e.target.value })} />
            </label>
          ))}
          <button type="submit" disabled={busy}>{busy ? "Running…" : "Run report"}</button>
        </form>
      )}
      {busy && <p className="muted" role="status">Running. New values mean new Cala queries, up to a minute…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {data.run.error && <p className="error">Main query: {data.run.error}</p>}

      {data.run.steps.map((step, i) => {
        const cell = <span className="muted cellno">cell {i + 2}</span>;
        if (step.chart) {
          return (
            <section className="board" key={i}>
              <h2>{`${step.board.y} by ${step.board.x}`.replaceAll("_", " ")} {cell}</h2>
              {step.info && <p className="muted">{step.info}</p>}
              <ChartTabs step={step} />
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
              <Table rows={step.rows} columns={step.outColumns} total={step.rowCount} />
            </section>
          );
        }
        if (step.board.type === "note" && step.text) {
          return (
            <section className="board note" key={i}>
              {changed.length > 0 && (
                <p className="stale" role="note">
                  This text was written for {writtenFor}. The charts above are live for your values; the numbers in this text are not.
                </p>
              )}
              <p className="story">{step.text}</p>
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
