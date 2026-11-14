// Templates in MongoDB (collection "templates", the template id is _id).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, type Collection } from "mongodb";
import type { Template } from "../shared/types.ts";
import { ROOT } from "./env.ts";

type Doc = Template & { _id: string };

let collection: Promise<Collection<Doc>> | undefined;

async function connect(): Promise<Collection<Doc>> {
  const uri = (process.env.MONGODB_CONNECTION_STRING ?? "").trim();
  if (!uri) throw new Error("MONGODB_CONNECTION_STRING missing. Put it in cala-data-visualization/.env.");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: "cala-contour" });
  await client.connect();
  const templates = client.db(process.env.MONGODB_DB || "cala_contour").collection<Doc>("templates");
  await seedFromFiles(templates);
  return templates;
}

/** First run against an empty collection: import the JSON templates in saved/. The files stay as a backup. */
async function seedFromFiles(templates: Collection<Doc>): Promise<void> {
  const dir = join(ROOT, "saved");
  if (!existsSync(dir) || (await templates.estimatedDocumentCount()) > 0) return;
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Template)
    .map((t) => ({ ...t, _id: t.id }));
  if (docs.length) {
    await templates.insertMany(docs, { ordered: false });
    console.log(`Imported ${docs.length} templates from saved/ into MongoDB.`);
  }
}

/** One shared connection; a failed connect is retried on the next request instead of staying broken. */
export function templates(): Promise<Collection<Doc>> {
  collection ??= connect().catch((err) => {
    collection = undefined;
    throw err;
  });
  return collection;
}

export function toTemplate({ _id, ...t }: Doc): Template {
  return { ...t, id: _id };
}
