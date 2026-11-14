import type { Board } from "./types.ts";

/** A temporary selection: one or more bars of the chart at board index `step`. Never saved. */
export interface Selection {
  step: number;
  labels: string[];
}

/** Values joined for an "is one of" filter. Must match ONE_OF_SEP in the engine. */
export const joinValues = (labels: string[]) => labels.join(" | ");

/** "location = Oslo" or "location is one of Oslo, Turku": for banners and tags. */
export const describeSelection = (column: string, labels: string[]) =>
  labels.length === 1 ? `${column} = ${labels[0]}` : `${column} is one of ${labels.join(", ")}`;

/**
 * Where a selection on the chart at board index `index` filters the path.
 * If the chart is drawn from an aggregate grouped by its x column, the filter goes before that aggregate,
 * so the cells below see the underlying rows for that group. Otherwise it goes right after the chart.
 */
export function selectionAt(boards: Board[], index: number): number {
  let k = index - 1;
  while (k >= 0 && ["chart", "note", "check"].includes(boards[k].type)) k--;
  return k >= 0 && boards[k].type === "aggregate" && boards[k].group === boards[index].x ? k : index + 1;
}
