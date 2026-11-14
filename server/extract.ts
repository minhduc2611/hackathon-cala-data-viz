// "Fill from deck": Claude reads pasted text and returns a value for each template parameter.
// It only fills inputs; every check is then done by the engine against Cala data.
import Anthropic from "@anthropic-ai/sdk";
import type { Template } from "../shared/types.ts";
import { paramNames } from "./engine.ts";

const MODEL = "claude-opus-5-5";
const MAX_TEXT = 60_000; // characters of deck text sent; a deck's text is far smaller

export async function extractParams(template: Template, text: string): Promise<{ params: Record<string, string>; notes: string }> {
  const names = paramNames(template);
  const hints = template.paramHints ?? {};
  const schema = {
    type: "object",
    properties: {
      params: {
        type: "object",
        properties: Object.fromEntries(names.map((n) => [n, { type: "string", description: hints[n] ?? n }])),
        required: names,
        additionalProperties: false,
      },
      notes: { type: "string", description: "One or two sentences: which values were not stated in the text, or were ambiguous." },
    },
    required: ["params", "notes"],
    additionalProperties: false,
  };
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You extract values from a startup pitch deck or memo so an analyst can check them against sourced data. " +
      "Copy what the text claims; do not correct it, look anything up, or guess. Use an empty string for anything the text does not state. " +
      "Write money as the text states it (e.g. $45M, $1.2B).",
    messages: [
      {
        role: "user",
        content:
          `Template: ${template.name}\nParameters to fill:\n${names.map((n) => `- ${n}: ${hints[n] ?? "(no description)"}`).join("\n")}` +
          `\n\n<deck>\n${text.slice(0, MAX_TEXT)}\n</deck>`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this text.");
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(raw) as { params: Record<string, unknown>; notes: string };
  const params = Object.fromEntries(names.map((n) => [n, String(parsed.params?.[n] ?? "").trim()]));
  return { params, notes: String(parsed.notes ?? "") };
}
