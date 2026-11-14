import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Row } from "../shared/types.ts";
import { drill } from "../web/src/drill.ts";
import { cleanBoard, fill, num, paramNames, runPath, runWithSelection } from "./engine.ts";

const rows: Row[] = [
  { name: "A", city: "Oslo", funding: "10M" },
  { name: "B", city: "Oslo", funding: "n/a" },
  { name: "C", city: "Turku", funding: "2M" },
];
const none = async (_query: string) => [] as Row[];
const run = (boards: Board[], params: Record<string, string> = {}, fetch = none) => runPath(rows, boards, params, fetch);

test("params", () => {
  assert.equal(fill("companies.industry={{ industry }}.x", { industry: "fintech" }), "companies.industry=fintech.x");
  const t = { id: "t", name: "", params: {}, query: "a={{x}}", boards: [{ type: "filter", value: "{{y}}" }, { type: "note", text: "{{x}}" }] as Board[] };
  assert.deepEqual(paramNames(t), ["x", "y"]);
});

test("number parser", () => {
  assert.equal(num("€38.9M"), 38.9e6);
  assert.equal(num("~206,753"), 206753);
  assert.equal(num("over 100M"), 100e6);
  assert.equal(num("~$9.4B raised; ~$159B valuation"), 9.4e9);
  assert.equal(num("Public (Euronext: ADYEN)"), null);
  assert.equal(num("5 Berlin"), 5);
  assert.equal(num("$32 billion"), 32e9);
  assert.equal(num("$68.7 B"), 68.7e9);
  assert.equal(num("$3T+ market cap"), 3e12);
  assert.equal(num("~$500–650 million"), 500e6);
  assert.equal(num("-5"), -5);
});

test("filter", async () => {
  let r = await run([{ type: "filter", column: "funding", op: ">", value: "{{min}}" }], { min: "5M" });
  assert.deepEqual(r.rows.map((x) => x.name), ["A"]);
  r = await run([{ type: "filter", column: "city", op: "=", value: "{{c}}" }]);
  assert.equal(r.rows.length, 3);
  assert.ok(r.steps[0].info);
});

test("aggregate and chart", async () => {
  const r = await run([
    { type: "aggregate", group: "city", metric: "funding", fn: "sum" },
    { type: "chart", kind: "bar", x: "city", y: "sum_funding" },
  ]);
  assert.deepEqual(r.rows, [{ city: "Oslo", sum_funding: "10000000" }, { city: "Turku", sum_funding: "2000000" }]);
  assert.deepEqual(r.steps[1].chart?.values, [10e6, 2e6]);
  const c = await run([{ type: "aggregate", group: "city", metric: "", fn: "count" }]);
  assert.deepEqual(c.rows[0], { city: "Oslo", count: "2" });
});

test("missing column errors and passes rows through", async () => {
  const r = await run([{ type: "chart", kind: "bar", x: "nope", y: "funding" }]);
  assert.match(r.steps[0].error, /nope/);
  assert.equal(r.rows, rows);
  assert.equal(r.steps[0].chart, undefined);
});

test("second query and join", async () => {
  const other: Row[] = [{ city: "oslo", count: "7", mayor: "X" }];
  const r = await run(
    [
      { type: "aggregate", group: "city", metric: "", fn: "count" },
      { type: "query", name: "b", query: "people.city={{c}}" },
      { type: "join", other: "main", on: "city" },
      { type: "join", other: "nope", on: "city" },
    ],
    { c: "oslo" },
    async (q) => (q === "people.city=oslo" ? other : []),
  );
  assert.deepEqual(r.rows, [{ city: "oslo", count: "7", mayor: "X", "main.count": "2" }]);
  assert.deepEqual(r.steps[2].sources, ["main"]);
  assert.match(r.steps[3].error, /nope/);
});

test("split makes one row per list item", async () => {
  const r = await runPath(
    [{ name: "A", investors: "Sequoia, Benchmark" }, { name: "B", investors: "Sequoia" }, { name: "C", investors: "" }],
    [{ type: "split", column: "investors", sep: "," }, { type: "aggregate", group: "investors", metric: "", fn: "count" }],
    {}, none,
  );
  assert.deepEqual(r.steps[0].rows.map((x) => x.investors), ["Sequoia", "Benchmark", "Sequoia"]);
  assert.deepEqual(r.rows, [{ investors: "Sequoia", count: "2" }, { investors: "Benchmark", count: "1" }]);
});

test("sort and not contains", async () => {
  const r = await run([
    { type: "filter", column: "name", op: "not contains", value: "b" },
    { type: "sort", column: "funding", order: "desc" },
  ]);
  assert.deepEqual(r.rows.map((x) => x.name), ["A", "C"]);
  const empty = await runPath([{ a: "" }, { a: "x" }, { a: " " }], [{ type: "filter", column: "a", op: "is empty", value: "" }], {}, none);
  assert.equal(empty.rows.length, 2);
  const full = await runPath([{ a: "" }, { a: "x" }], [{ type: "filter", column: "a", op: "is not empty", value: "" }], {}, none);
  assert.deepEqual(full.rows, [{ a: "x" }]);
  const asc = await run([{ type: "sort", column: "funding", order: "asc" }]);
  assert.deepEqual(asc.rows.map((x) => x.name), ["C", "A", "B"]); // "n/a" has no number: last
});

test("check compares claims with sourced rows", async () => {
  const rounds = [{ amount: "$10M", lead: "Sequoia" }, { amount: "~$30M", lead: "Benchmark and others" }];
  const r = await runPath(rounds, [
    { type: "check", claim: "Total", column: "amount", test: "sum", value: "{{total}}", tolerance: "20" },
    { type: "check", claim: "Largest", column: "amount", test: "max", value: "100M", tolerance: "20" },
    { type: "check", claim: "Lead", column: "lead", test: "contains", value: "benchmark", tolerance: "" },
    { type: "check", claim: "Lead", column: "lead", test: "contains", value: "a16z", tolerance: "" },
    { type: "check", claim: "Blank", column: "lead", test: "contains", value: "{{nothing}}", tolerance: "" },
  ], { total: "$38M" }, none);
  assert.deepEqual(r.steps.map((s) => s.check?.verdict), ["matches", "differs", "matches", "not in sources", "no claim"]);
  assert.match(r.steps[1].check!.detail, /70% below the claimed \$100M/);
  assert.equal(r.rows, rounds); // checks never change rows
});

test("drill-down finds the rows behind a bar and where a filter goes", async () => {
  const main: Row[] = [{ name: "A", city: "Oslo" }, { name: "B", city: "Oslo" }, { name: "C", city: "Turku" }];
  const viaAggregate = await runPath(main, [
    { type: "aggregate", group: "city", metric: "", fn: "count" },
    { type: "chart", kind: "bar", x: "city", y: "count" },
  ], {}, none);
  const run = { resolved: "", error: "", rows: main, rowCount: 3, columns: ["name", "city"], steps: viaAggregate.steps };
  const d = drill(run, 1, "Oslo");
  assert.deepEqual(d.rows.map((r) => r.name), ["A", "B"]); // the companies behind "Oslo: 2", not the count row
  assert.equal(d.insertAt, 0); // filter goes before the aggregate
  const direct = await runPath(main, [{ type: "chart", kind: "bar", x: "name", y: "name" }], {}, none);
  const d2 = drill({ ...run, steps: direct.steps }, 0, "C");
  assert.deepEqual(d2.rows, [{ name: "C", city: "Turku" }]);
  assert.equal(d2.insertAt, 1); // no aggregate: filter goes after the chart
});

test("a selection narrows only the cells below the chart", async () => {
  const main: Row[] = [
    { name: "A", city: "Oslo", funding: "10M" },
    { name: "B", city: "Oslo", funding: "5M" },
    { name: "C", city: "Turku", funding: "2M" },
  ];
  const boards: Board[] = [
    { type: "aggregate", group: "city", metric: "", fn: "count" }, // cell 2
    { type: "chart", kind: "bar", x: "city", y: "count" }, // cell 3: the user clicks "Oslo"
    { type: "query", name: "other", query: "x" }, // a new source: not narrowed
  ];
  const plain = await runWithSelection(main, boards.slice(0, 2), {}, none);
  assert.equal(plain.steps[1].chart?.selected, undefined);
  const path: Board[] = [
    ...boards.slice(0, 2),
    { type: "sort", column: "count", order: "desc" }, // cell 4: below the chart, sees the selection
    boards[2],
  ];
  // The aggregate above the chart is the selection point, so cell 4 sees Oslo's aggregate row only.
  const r = await runWithSelection(main, path, {}, async () => [{ x: "1" }], { step: 1, label: "Oslo" });
  assert.deepEqual(r.steps[1].chart?.labels, ["Oslo", "Turku"]); // the clicked chart keeps every bar
  assert.equal(r.steps[1].chart?.selected, "Oslo");
  assert.deepEqual(r.steps[2].rows, [{ city: "Oslo", count: "2" }]);
  assert.equal(r.steps[2].selection, "city = Oslo");
  assert.equal(r.steps[3].selection, undefined); // the new query source has no "city" column: not narrowed
  assert.equal(r.steps.length, path.length); // the inserted filter is not shown as a cell
});

test("a selection cross-filters a later section that has the same value", async () => {
  const main: Row[] = [{ year: "2016", price: "1B" }, { year: "2020", price: "2B" }];
  const rival: Row[] = [{ year: "2016", deal: "X" }, { year: "2016", deal: "Y" }, { year: "2021", deal: "Z" }];
  const other: Row[] = [{ year: "1999", deal: "Q" }];
  const path: Board[] = [
    { type: "chart", kind: "bar", x: "year", y: "price" }, // click 2016
    { type: "query", name: "rival", query: "rival" }, // has 2016: narrowed
    { type: "sort", column: "deal", order: "asc" },
    { type: "query", name: "other", query: "other" }, // no 2016: left alone
    { type: "sort", column: "deal", order: "asc" },
  ];
  const fetch = async (q: string) => (q === "rival" ? rival : other);
  const r = await runWithSelection(main, path, {}, fetch, { step: 0, label: "2016" });
  assert.deepEqual(r.steps[2].rows.map((x) => x.deal), ["X", "Y"]);
  assert.equal(r.steps[2].selection, "year = 2016");
  assert.deepEqual(r.steps[4].rows, other);
  assert.equal(r.steps[4].selection, undefined);
  assert.equal(r.steps.length, path.length);
});

test("cleanBoard keeps only the type's fields", () => {
  assert.deepEqual(cleanBoard({ type: "chart", x: "a", y: "b", extra: "z" }), { type: "chart", kind: "bar", x: "a", y: "b" });
  assert.throws(() => cleanBoard({ type: "pivot" }), /Unknown cell type/);
});
