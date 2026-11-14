import { selectionAt } from "../../shared/selection.ts";
import type { Row, Run } from "../../shared/types.ts";

export interface Drill {
  column: string; // the chart's x column, which a drill-down filter uses
  rows: Row[]; // rows behind the clicked bar
  capped: boolean; // true when the source rows were cut to the preview size, so more may exist
  insertAt: number; // board index where a "keep only" filter goes
  aggregated: boolean; // the chart sits on an aggregate, so the rows are the aggregate's input
}

/**
 * The rows behind one bar of the chart at step `index`.
 * If the chart is drawn from an aggregate grouped by its x column, the detail is the aggregate's input
 * (the companies behind "San Francisco: 13"), and a filter belongs before that aggregate.
 * Otherwise the detail is the chart's own rows and a filter goes right after the chart.
 */
export function drill(run: Run, index: number, label: string): Drill {
  const chart = run.steps[index];
  const column = chart.board.x;
  const k = selectionAt(run.steps.map((s) => s.board), index);
  const aggregated = k <= index;
  const source = !aggregated ? chart : k === 0 ? null : run.steps[k - 1];
  const rows = source ? source.rows : run.rows;
  const total = source ? source.rowCount : run.rowCount;
  return {
    column,
    rows: rows.filter((r) => (r[column] ?? "") === label),
    capped: rows.length < total,
    insertAt: aggregated ? k : index + 1,
    aggregated,
  };
}
