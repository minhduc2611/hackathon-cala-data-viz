import type { Row } from "../../shared/types.ts";

export function Table({ rows, columns, total }: { rows: Row[]; columns: string[]; total: number }) {
  if (!total) return <p className="muted">0 rows</p>;
  return (
    <>
      <p className="muted">{rows.length < total ? `First ${rows.length} of ` : ""}{total} rows</p>
      <div className="scroll" tabIndex={0}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>{columns.map((c) => <td key={c}>{row[c]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
