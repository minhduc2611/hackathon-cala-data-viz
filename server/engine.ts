// The board engine: {{params}}, number parsing and running a path of cells.
import { DEFAULTS, FIELDS, type Board, type Row, type Step, type Template } from "../shared/types.ts";

export const ROW_CAP = 200;
export const CHART_CAP = 50;
const PARAM = /\{\{\s*(\w+)\s*\}\}/g;
const NUMBER = /(-?\d[\d,]*(?:\.\d+)?)(?:\s*[–-]\s*\d[\d,]*(?:\.\d+)?)?(?:\s*(thousand|million|billion|trillion|bn|mn|[KMBT])\b)?/i;
const SCALE: Record<string, number> = {
  K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12, BN: 1e9, MN: 1e6,
};
const NUMERIC: Record<string, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

export function fill(text: string | undefined, params: Record<string, string>): string {
  return (text ?? "").replace(PARAM, (_, name: string) => params[name] ?? "");
}

export function paramNames(template: Template): string[] {
  const texts = [template.query, ...template.boards.flatMap((b) => [b.query, b.value, b.text])];
  return [...new Set(texts.flatMap((t) => [...(t ?? "").matchAll(PARAM)].map((m) => m[1])))];
}

export function unset(text: string | undefined, params: Record<string, string>): string[] {
  return [...new Set([...(text ?? "").matchAll(PARAM)].map((m) => m[1]).filter((n) => !(params[n] ?? "").trim()))];
}

// shortcut: first number plus K/M/B/T or the word (million, billion…); a range "500–650 million" reads as its
// low end. Not a unit or currency parser. Upgrade when
// cells like "13–15.8B" or "2 million" need to be right.
export function num(text: string | undefined): number | null {
  const match = NUMBER.exec(String(text ?? ""));
  if (!match) return null;
  return Number(match[1].replaceAll(",", "")) * (SCALE[(match[2] ?? "").toUpperCase()] ?? 1);
}

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

/** "$4.8B", "$30.7M", "1,200" for check results. */
export function money(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${Number((value / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `$${Number((value / 1e6).toFixed(1))}M`;
  return value.toLocaleString("en-US");
}

export function columns(rows: Row[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

function missing(name: string | undefined, cols: string[]): string {
  if (!name) return "Choose a column.";
  return cols.includes(name) ? "" : `Column "${name}" is not in the rows at this step. Board skipped.`;
}

/** A board with exactly its type's fields, defaults filled, everything a string. */
export function cleanBoard(input: Record<string, unknown>): Board {
  const type = input.type as Board["type"];
  if (!(type in FIELDS)) throw new Error(`Unknown cell type "${String(input.type)}". Use one of: ${Object.keys(FIELDS).join(", ")}.`);
  const board: Board = { type };
  for (const field of FIELDS[type]) board[field] = String(input[field] ?? "").trim() || DEFAULTS[field] || "";
  return board;
}

/** Apply boards in order. A query board starts a new source; earlier sources stay joinable by name. */
export async function runPath(
  start: Row[],
  boards: Board[],
  params: Record<string, string>,
  fetch: (query: string) => Promise<Row[]>,
): Promise<{ steps: Step[]; rows: Row[] }> {
  const steps: Step[] = [];
  const sources: Record<string, Row[]> = {};
  let current = "main";
  let rows = start;
  for (const board of boards) {
    const cols = columns(rows);
    const step: Step = {
      board, columns: cols, sources: Object.keys(sources), error: "", info: "",
      rows: [], rowCount: 0, outColumns: [],
    };
    if (board.type === "filter") {
      const { column = "", op = "=" } = board;
      const value = fill(board.value, params).trim();
      if (op === "is empty" || op === "is not empty") {
        if (missing(column, cols)) step.error = missing(column, cols);
        else rows = rows.filter((r) => !(r[column] ?? "").trim() === (op === "is empty"));
      } else if (!value) step.info = "No value set. Filter ignored.";
      else if (missing(column, cols)) step.error = missing(column, cols);
      else if (op in NUMERIC) {
        const target = num(value);
        if (target === null) step.error = `"${value}" is not a number.`;
        else rows = rows.filter((r) => { const n = num(r[column]); return n !== null && NUMERIC[op](n, target); });
      } else {
        const want = value.toLowerCase();
        const test = ({
          "=": (have: string) => have === want,
          "!=": (have: string) => have !== want,
          contains: (have: string) => have.includes(want),
          "not contains": (have: string) => !have.includes(want),
        } as Record<string, (have: string) => boolean>)[op];
        if (!test) step.error = `Unknown operator "${op}".`;
        else rows = rows.filter((r) => test((r[column] ?? "").trim().toLowerCase()));
      }
    } else if (board.type === "aggregate") {
      const { group = "", metric = "", fn = "count" } = board;
      step.error = missing(group, cols) || (fn !== "count" ? missing(metric, cols) : "");
      if (!["count", "sum", "avg"].includes(fn)) step.error = `Unknown function "${fn}".`;
      if (!step.error) {
        const name = fn === "count" ? "count" : `${fn}_${metric}`;
        const buckets = new Map<string, number[]>();
        for (const r of rows) {
          const v = fn === "count" ? 1 : num(r[metric]);
          const list = buckets.get(r[group] ?? "") ?? [];
          if (v !== null) list.push(v);
          buckets.set(r[group] ?? "", list);
        }
        const out = [...buckets].map(([k, vs]) => {
          const total = vs.reduce((a, b) => a + b, 0);
          return [k, vs.length ? (fn === "avg" ? total / vs.length : total) : null] as const;
        });
        out.sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity));
        rows = out.map(([k, total]) => ({ [group]: k, [name]: total === null ? "" : fmt(total) }));
      }
    } else if (board.type === "split") {
      // One row per item: turns a list cell ("Sequoia, Benchmark") into edges you can count.
      const { column = "", sep = "," } = board;
      step.error = missing(column, cols);
      if (!step.error) {
        rows = rows.flatMap((r) => {
          const parts = (r[column] ?? "").split(sep || ",").map((p) => p.trim()).filter(Boolean);
          return parts.length ? parts.map((p) => ({ ...r, [column]: p })) : [];
        });
      }
    } else if (board.type === "sort") {
      // Numbers sort as numbers; cells without a number go last either way.
      const { column = "", order = "desc" } = board;
      step.error = missing(column, cols);
      if (!step.error) {
        const dir = order === "asc" ? 1 : -1;
        const allText = rows.every((r) => num(r[column]) === null);
        rows = [...rows].sort((a, b) => {
          if (allText) return dir * (a[column] ?? "").localeCompare(b[column] ?? "");
          const x = num(a[column]), y = num(b[column]);
          if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
          return dir * (x - y);
        });
      }
    } else if (board.type === "check") {
      // Compares a claim with the sourced rows; never changes the rows.
      const { claim = "Claim", column = "", test = "sum" } = board;
      const claimed = fill(board.value, params).trim();
      const tolerance = Math.max(0, Number(board.tolerance || 20)) / 100;
      const result = (verdict: NonNullable<Step["check"]>["verdict"], found: string, detail: string) => {
        step.check = { claim, claimed, found, verdict, detail };
      };
      if (!claimed) result("no claim", "", "No claimed value set.");
      else if (missing(column, cols)) step.error = missing(column, cols);
      else if (test === "contains") {
        const want = claimed.toLowerCase();
        const hits = rows.filter((r) => (r[column] ?? "").toLowerCase().includes(want));
        if (hits.length) result("matches", hits.map((r) => r[column]).slice(0, 3).join(" · "), `Named in ${hits.length} of ${rows.length} sourced rows.`);
        else result("not in sources", "", `"${claimed}" does not appear in ${column} in any of ${rows.length} sourced rows.`);
      } else if (test === "sum" || test === "max") {
        const target = num(claimed);
        const values = rows.map((r) => num(r[column])).filter((v): v is number => v !== null);
        if (target === null || target === 0) step.error = `Claimed value "${claimed}" is not a number.`;
        else if (!values.length) result("not in sources", "", `No ${column} figures in ${rows.length} sourced rows.`);
        else {
          const found = test === "sum" ? values.reduce((a, b) => a + b, 0) : Math.max(...values);
          const gap = (found - target) / target;
          const what = test === "sum" ? `Sum of ${values.length} sourced ${column} figures` : `Largest of ${values.length} sourced ${column} figures`;
          result(
            Math.abs(gap) <= tolerance ? "matches" : "differs",
            money(found),
            `${what}: ${money(found)}, ${Math.abs(Math.round(gap * 100))}% ${gap < 0 ? "below" : "above"} the claimed ${money(target)} (tolerance ${Math.round(tolerance * 100)}%).`,
          );
        }
      } else step.error = `Unknown test "${test}". Use sum, max or contains.`;
    } else if (board.type === "chart") {
      const { x = "", y = "" } = board;
      step.error = missing(x, cols) || missing(y, cols);
      if (!step.error) {
        const shown = rows.slice(0, CHART_CAP);
        const values = shown.map((r) => num(r[y]));
        if (values.every((v) => v === null)) step.error = `No numbers in column "${y}".`;
        else {
          step.chart = { kind: board.kind === "line" ? "line" : "bar", labels: shown.map((r) => r[x] ?? ""), values, y };
          if (rows.length > CHART_CAP) step.info = `Showing the first ${CHART_CAP} of ${rows.length} rows.`;
        }
      }
    } else if (board.type === "query") {
      sources[current] = rows;
      current = step.name = board.name || `q${Object.keys(sources).length + 1}`;
      step.resolved = fill(board.query, params).trim();
      rows = [];
      const blank = unset(board.query, params);
      if (blank.length) step.error = "Set a value for: " + blank.join(", ");
      else if (!step.resolved) step.info = "Write a query.";
      else {
        try {
          rows = await fetch(step.resolved);
        } catch (err) {
          step.error = (err as Error).message;
        }
      }
    } else if (board.type === "join") {
      const { other = "", on = "" } = board;
      if (!(other in sources)) {
        step.error = `No source named "${other}" above this cell. Sources: ${Object.keys(sources).join(", ") || "none"}.`;
      } else {
        step.error = missing(on, cols);
        if (!step.error && !columns(sources[other]).includes(on)) step.error = `Column "${on}" is not in source "${other}".`;
      }
      if (!step.error) {
        // shortcut: left join on the first match only, no row multiplication.
        // Upgrade when the other source has several rows per key that all matter.
        const lookup = new Map<string, Row>();
        for (const r of sources[other]) {
          const k = (r[on] ?? "").trim().toLowerCase();
          if (!lookup.has(k)) lookup.set(k, r);
        }
        rows = rows.map((r) => {
          const match = lookup.get((r[on] ?? "").trim().toLowerCase()) ?? {};
          const extra = Object.entries(match).filter(([k]) => k !== on).map(([k, v]) => [k in r ? `${other}.${k}` : k, v]);
          return { ...r, ...Object.fromEntries(extra) };
        });
      }
    } else if (board.type === "note") {
      step.text = fill(board.text, params);
    }
    step.rows = rows.slice(0, ROW_CAP);
    step.rowCount = rows.length;
    step.outColumns = columns(rows);
    steps.push(step);
  }
  return { steps, rows };
}
