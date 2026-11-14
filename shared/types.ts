// Shapes shared by the server and the React app.

export type Row = Record<string, string>;

export const FIELDS = {
  filter: ["column", "op", "value"],
  aggregate: ["group", "metric", "fn"],
  split: ["column", "sep"],
  sort: ["column", "order"],
  chart: ["kind", "x", "y"],
  note: ["text"],
  join: ["other", "on"],
  query: ["name", "query"],
} as const;

export type BoardType = keyof typeof FIELDS;
export const BOARD_TYPES = Object.keys(FIELDS) as BoardType[];
export const OPS = ["=", "!=", "contains", "not contains", ">", "<", ">=", "<=", "is empty", "is not empty"] as const;
export const DEFAULTS: Record<string, string> = { op: "=", fn: "count", kind: "bar", sep: ",", order: "desc" };

// Board fields are all strings, so a board stays a flat form.
export interface Board {
  type: BoardType;
  [field: string]: string;
}

export interface Template {
  id: string;
  name: string;
  query: string;
  params: Record<string, string>;
  boards: Board[];
}

export interface ChartData {
  kind: "bar" | "line";
  labels: string[];
  values: (number | null)[];
  y: string;
}

export interface Step {
  board: Board;
  columns: string[]; // columns going into this cell
  sources: string[]; // sources a join here can use
  error: string;
  info: string;
  name?: string; // query cells: source name
  resolved?: string; // query cells: query after {{params}}
  text?: string; // note cells: text after {{params}}
  chart?: ChartData;
  rows: Row[]; // rows out of this cell, capped
  rowCount: number;
  outColumns: string[];
}

export interface Run {
  resolved: string;
  error: string;
  rows: Row[];
  rowCount: number;
  columns: string[];
  steps: Step[];
}

export interface Analysis {
  template: Template;
  paramNames: string[];
  run: Run;
  savedParams?: Record<string, string>; // report runs: the template's own values, which its notes were written for
}

export interface Suggestions {
  entities: string[];
  fields: string[];
}

export interface ChatAction {
  tool: string;
  input: unknown;
  error: boolean;
}

export interface ChatReply {
  reply: string;
  actions: ChatAction[];
  analysis: Analysis;
}
