import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, inline } from "./Markdown.tsx";

test("chat markdown: blocks", () => {
  const b = blocks("Done.\n\n- **Who's competing (cells 1–4):** Stripe (~$9.4B)\n- second\n  continued\n\n1. one\n2. two\n## Head\nKeep these limits in mind:");
  assert.deepEqual(b.map((x) => x.kind), ["p", "ul", "ol", "h", "p"]);
  assert.deepEqual((b[1] as { items: string[] }).items, ["**Who's competing (cells 1–4):** Stripe (~$9.4B)", "second continued"]);
});

test("chat markdown: inline marks, money and snake_case left alone", () => {
  const parts = inline("a **b** c `d` *e* $4.5B+ snake_case_name");
  assert.equal(parts.filter((p) => typeof p !== "string").length, 3);
  assert.equal(parts.at(-1), " $4.5B+ snake_case_name");
});
