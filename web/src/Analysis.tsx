import { useEffect, useState } from "react";
import type { Analysis as AnalysisData, Board } from "../../shared/types.ts";
import { AddCellMenu } from "./AddCellMenu.tsx";
import { api } from "./api.ts";
import { Cell } from "./Cell.tsx";
import { Chat } from "./Chat.tsx";
import { QueryBox } from "./QueryBox.tsx";
import { Table } from "./Table.tsx";

export function Analysis({ id }: { id: string }) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});

  function show(next: AnalysisData) {
    setData(next);
    setName(next.template.name);
    setQuery(next.template.query);
    setParams(next.template.params);
  }

  /** Every change goes through here: the server saves, re-runs the path and returns it. */
  async function act(request: () => Promise<AnalysisData>) {
    setBusy(true);
    setError("");
    try {
      show(await request());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    act(() => api.get(id));
  }, [id]);

  if (!data) {
    return (
      <main>
        <p><a href="#/">All templates</a></p>
        {error ? <p className="error">{error}</p> : <p className="muted">Running the path. A new Cala query takes up to a minute…</p>}
      </main>
    );
  }

  const { run } = data;
  // Inputs follow the query box live: a {{variable}} gets its input as you type it, and loses it when deleted.
  // Variables used in other cells (filter values, notes, query cells) keep theirs.
  const used = [query, ...data.template.boards.flatMap((b) => [b.query, b.value, b.text])];
  const paramNames = [...new Set(used.flatMap((t) => [...(t ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])))];
  const run1 = (e: React.FormEvent) => {
    e.preventDefault();
    act(() => api.update(id, { name, query, params }));
  };

  return (
    <main aria-busy={busy}>
      <p className="topbar">
        <a href="#/">All templates</a>
        <a className="play" href={`#/r/${id}`}>run report</a>
      </p>
      <section className="board">
        <h3>[1] query · main</h3>
        <form onSubmit={run1}>
          <p><label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label></p>
          <p className="query-help">
            <label htmlFor="q-main">Cala query</label>
            <button type="button" className="info">
              <span aria-hidden="true">i</span>
              <span className="tip" role="tooltip">
                Write {"{{name}}"} for a parameter; it also works in filter values and notes. Chain clauses with a dot:
                .field=value, .order_by=field DESC, .limit=N, .return(f1, f2). Suggestions are hints, not a full list.
              </span>
            </button>
          </p>
          <QueryBox id="q-main" value={query} onChange={setQuery} />
          <p>
            {paramNames.map((p) => (
              <label key={p}>
                <span className="label-chip">{p}</span> <input value={params[p] ?? ""} onChange={(e) => setParams({ ...params, [p]: e.target.value })} />
              </label>
            ))}
            <button type="submit" disabled={busy}>Run</button>{" "}
            <button type="button" className="quiet" disabled={busy} onClick={() => act(() => api.refresh(id))}>Refresh data</button>
          </p>
        </form>
        {run.error && <p className="error">{run.error}</p>}
        {run.resolved && !run.error && <Table rows={run.rows} columns={run.columns} total={run.rowCount} />}
      </section>

      {run.steps.map((step, i) => (
        <Cell
          key={i + JSON.stringify(step.board)}
          number={i + 2}
          step={step}
          run={run}
          busy={busy}
          onSave={(board) => act(() => api.saveBoard(id, i, board))}
          onDelete={() => act(() => api.deleteBoard(id, i))}
          onInsert={(board, at) => act(() => api.addBoard(id, board, at))}
          onSelect={(sel) => act(() => api.play(id, data.template.params, sel))}
        />
      ))}

      <AddCellMenu disabled={busy} onAdd={(type) => act(() => api.addBoard(id, { type } as Board))} />
      {busy && <p className="muted" role="status">Running…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <Chat id={id} onAnalysis={show} />
    </main>
  );
}
