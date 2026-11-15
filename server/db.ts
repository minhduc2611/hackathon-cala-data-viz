// MongoDB: templates (collection "templates", the template id is _id) and the Cala answer cache ("cala_cache").
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, type Collection, type Db } from "mongodb";
import type { Template } from "../shared/types.ts";
import { ROOT } from "./env.ts";

type Doc = Template & { _id: string };

/** One cached Cala answer. _id = sha256 of the request; the answer is stored as JSON text (no key restrictions). */
export interface CacheDoc {
  _id: string;
  kind: "query" | "tool" | "meta"; // query = knowledge_query rows, used by the query-box suggestions
  json: string;
  signature?: string; // the request, truncated: for reading the cache by eye
  createdAt: Date;
}

let database: Promise<Db> | undefined;

export const dbName = () => process.env.MONGODB_DB || "cala_contour";

async function connect(): Promise<Db> {
  const uri = (process.env.MONGODB_CONNECTION_STRING ?? "").trim();
  if (!uri) throw new Error("MONGODB_CONNECTION_STRING missing. Put it in cala-data-visualization/.env.");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: "cala-contour" });
  await client.connect();
  const db = client.db(dbName());
  await seedFromFiles(db.collection<Doc>("templates"));
  await importDiskCache(db.collection<CacheDoc>("cala_cache"));
  return db;
}

/** First run against an empty cache: import the old .cache/ files, so answers already paid for are not fetched again. */
async function importDiskCache(cache: Collection<CacheDoc>): Promise<void> {
  const dir = join(ROOT, ".cache");
  if (!existsSync(dir) || (await cache.estimatedDocumentCount()) > 0) return;
  const docs: CacheDoc[] = [];
  for (const file of readdirSync(dir)) {
    const hash = /^([0-9a-f]{64})\.json$/.exec(file)?.[1]; // the old file name is the same request hash
    if (!hash) continue;
    const text = readFileSync(join(dir, file), "utf8");
    try {
      docs.push({ _id: hash, kind: Array.isArray(JSON.parse(text)) ? "query" : "tool", json: text, createdAt: statSync(join(dir, file)).mtime });
    } catch {
      // A broken file is simply fetched again later.
    }
  }
  if (docs.length) {
    await cache.insertMany(docs, { ordered: false });
    console.log(`Imported ${docs.length} cached Cala answers from .cache/ into MongoDB.`);
  }
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
function db(): Promise<Db> {
  database ??= connect().catch((err) => {
    database = undefined;
    throw err;
  });
  return database;
}

export async function templates(): Promise<Collection<Doc>> {
  return (await db()).collection<Doc>("templates");
}

export async function calaCache(): Promise<Collection<CacheDoc>> {
  return (await db()).collection<CacheDoc>("cala_cache");
}

export function toTemplate({ _id, ...t }: Doc): Template {
  return { ...t, id: _id };
}
