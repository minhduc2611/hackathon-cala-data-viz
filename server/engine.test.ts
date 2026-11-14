import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Row } from "../shared/types.ts";
import { cleanBoard, fill, num, paramNames, runPath } from "./engine.ts";

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

test("cleanBoard keeps only the type's fields", () => {
  assert.deepEqual(cleanBoard({ type: "chart", x: "a", y: "b", extra: "z" }), { type: "chart", kind: "bar", x: "a", y: "b" });
  assert.throws(() => cleanBoard({ type: "pivot" }), /Unknown cell type/);
});
