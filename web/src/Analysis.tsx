import { useEffect, useState } from "react";
import { BOARD_TYPES, type Analysis as AnalysisData, type Board, type BoardType } from "../../shared/types.ts";
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

  const { run, paramNames } = data;
  const run1 = (e: React.FormEvent) => {
    e.preventDefault();
    act(() => api.update(id, { name, query, params }));
  };

  return (
    <main aria-busy={busy}>
      <p className="topbar">
        <a href="#/">All templates</a>
        <a className="play" href={`#/r/${id}`}>▶ Play</a>
      </p>
      <section className="board">
        <h3>[1] query · main</h3>
        <form onSubmit={run1}>
          <p><label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label></p>
          <label htmlFor="q-main">
            Cala query. Write {"{{name}}"} for a parameter; it also works in filter values and notes. Chain clauses with a dot:
            .field=value, .order_by=field DESC, .limit=N, .return(f1, f2). Suggestions are hints, not a full list.
          </label>
          <QueryBox id="q-main" value={query} onChange={setQuery} />
          <p>
            {paramNames.map((p) => (
              <label key={p}>
                {p} <input value={params[p] ?? ""} onChange={(e) => setParams({ ...params, [p]: e.target.value })} />
              </label>
            ))}
            <button type="submit" disabled={busy}>Run</button>{" "}
            <button type="button" className="quiet" disabled={busy} onClick={() => act(() => api.refresh(id))}>Refresh data</button>
          </p>
        </form>
        {run.error && <p className="error">{run.error}</p>}
        {run.resolved && !run.error && (
          <>
            <p className="muted">{run.resolved}</p>
            <Table rows={run.rows} columns={run.columns} total={run.rowCount} />
          </>
        )}
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

      <p>
        Add{" "}
        {BOARD_TYPES.map((type: BoardType) => (
          <button key={type} type="button" className="quiet" disabled={busy} onClick={() => act(() => api.addBoard(id, { type } as Board))}>
            {type}
          </button>
        ))}
      </p>
      {busy && <p className="muted" role="status">Running…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <Chat id={id} onAnalysis={show} />
    </main>
  );
}
