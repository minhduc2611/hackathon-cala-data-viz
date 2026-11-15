// Shapes shared by the server and the React app.

export type Row = Record<string, string>;

export const FIELDS = {
  filter: ["column", "op", "value"],
  aggregate: ["group", "metric", "fn"],
  split: ["column", "sep"],
  sort: ["column", "order"],
  check: ["claim", "column", "test", "value", "tolerance"],
  chart: ["kind", "x", "y"],
  note: ["text"],
  join: ["other", "on"],
  graph: ["source", "target"],
  query: ["name", "query"],
} as const;

export type BoardType = keyof typeof FIELDS;
export const BOARD_TYPES = Object.keys(FIELDS) as BoardType[];
export const OPS = ["=", "!=", "contains", "not contains", "is one of", "is not one of", ">", "<", ">=", "<=", "is empty", "is not empty"] as const;
export const DEFAULTS: Record<string, string> = { op: "=", fn: "count", kind: "bar", sep: ",", order: "desc", test: "sum", tolerance: "20" };
export const TESTS = ["sum", "max", "contains"] as const;

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
  paramHints?: Record<string, string>; // what each parameter means; shown under the report fields
}

export interface ChartData {
  kind: "bar" | "line";
  labels: string[];
  values: (number | null)[];
  y: string;
  selected?: string[]; // the bars picked as the active selection
}

/** A two-sided network: source-column values on one side, target-column values on the other. */
export interface GraphData {
  source: string; // column names, for the legend
  target: string;
  nodes: { id: string; name: string; side: "source" | "target"; degree: number }[];
  // ids; weight = rows with that pair; rows = up to EDGE_SAMPLE of those rows, shown when the edge is clicked
  edges: { source: string; target: string; weight: number; rows: Row[] }[];
}

export interface CheckResult {
  claim: string;
  claimed: string;
  found: string; // what the sources say, as text
  verdict: "matches" | "differs" | "not in sources" | "no claim";
  detail: string;
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
  check?: CheckResult;
  graph?: GraphData;
  rows: Row[]; // rows out of this cell, capped
  rowCount: number;
  outColumns: string[];
  selection?: string; // set on cells whose rows are narrowed by the active selection, e.g. 'location = Oslo'
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

/** What the query box knows about one entity type, from Cala introspection. */
export interface EntitySchema {
  properties: string[];
  // word to type in the query; type at the other end if known; tested = seen working in a real query
  // examples = names of real neighbours Cala returned for the sample entity
  relations: { word: string; rel: string; type?: string; tested?: boolean; examples?: string[] }[];
}

export interface Suggestions {
  entities: string[];
  fields: string[];
  schema?: Record<string, EntitySchema>; // by entity type: Company, Person, …
  aliases?: Record<string, string>; // query start word -> type, e.g. companies -> Company
  values?: Record<string, string[]>; // values to offer after "field=", e.g. industry -> FINTECH, …
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
