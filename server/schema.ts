// Query-box schema: per entity type, its properties and the related entities you can step into.
// Built from Cala entity introspection of one well-known entity per type, through the cached Cala calls.
import type { EntitySchema } from "../shared/types.ts";
import { calaTool } from "./cala.ts";

/** One well-known entity per type to introspect. Introspection is per entity, Cala has no type-level schema. */
// [type to search, name]. The schema is stored under the type Cala returns ("GPE" Helsinki is a Municipality).
const SAMPLES: [type: string, name: string][] = [
  ["Company", "Stripe"],
  ["Person", "Patrick Collison"],
  ["Industry", "Fintech"],
  ["Country", "Finland"],
  ["Location", "Silicon Valley"], // properties only: Location entities have no relationships in Cala
  ["GPE", "Helsinki"],
];

/**
 * Introspection names a relationship but not the word the query language uses for it, nor the type at
 * the other end. This maps the common ones in both directions; `founders`, `investors` and `company`
 * are verified in real queries, the rest are hints. Unknown relationships fall back to their lowercased name.
 */
const REL: Record<string, { out?: [word: string, type: string]; in?: [word: string, type: string] }> = {
  FOUNDED: { out: ["founded", "Company"], in: ["founders", "Person"] },
  INVESTED_IN: { out: ["investments", "Company"], in: ["investors", "Company"] },
  IS_CEO_OF: { out: ["ceo_of", "Company"], in: ["ceo", "Person"] },
  IS_CTO_OF: { out: ["cto_of", "Company"], in: ["cto", "Person"] },
  IS_CFO_OF: { out: ["cfo_of", "Company"], in: ["cfo", "Person"] },
  IS_COO_OF: { out: ["coo_of", "Company"], in: ["coo", "Person"] },
  IS_CMO_OF: { out: ["cmo_of", "Company"], in: ["cmo", "Person"] },
  IS_CSO_OF: { out: ["cso_of", "Company"], in: ["cso", "Person"] },
  IS_CCO_OF: { out: ["cco_of", "Company"], in: ["cco", "Person"] },
  IS_EXECUTIVE_OF: { out: ["executive_of", "Company"], in: ["executives", "Person"] },
  IS_VICEPRESIDENT_OF: { out: ["vice_president_of", "Company"], in: ["vice_presidents", "Person"] },
  IS_MANAGING_DIRECTOR_OF: { out: ["managing_director_of", "Company"], in: ["managing_directors", "Person"] },
  IS_BOARD_MEMBER_OF: { out: ["board_seats", "Company"], in: ["board_members", "Person"] },
  WORKS_AT: { out: ["company", "Company"], in: ["employees", "Person"] },
  OPERATES_IN_INDUSTRY: { out: ["industry", "Industry"], in: ["companies", "Company"] },
  HAS_HEADQUARTERS_IN: { out: ["headquarters", "Country"], in: ["headquartered_companies", "Company"] },
  IS_REGISTERED_IN: { out: ["registered_in", "Country"], in: ["registered_companies", "Company"] },
  HAS_PRESENCE_IN: { out: ["locations", "Country"], in: ["companies_present", "Company"] },
  PARTICIPATES_IN_FUNDING_ROUND: { out: ["funding_rounds", "FundingRound"] },
  PARTICIPATES_IN_CORPORATE_EVENT: { out: ["corporate_events", "CorporateEvent"] },
  IS_ULTIMATE_PARENT_OF: { out: ["subsidiaries", "Company"], in: ["ultimate_parent", "Company"] },
  IS_DIRECT_PARENT_OF: { out: ["subsidiaries", "Company"], in: ["parent", "Company"] },
  STUDIED_AT: { out: ["education", "Organization"] },
  HAS_NATIONALITY: { out: ["nationality", "Country"], in: ["nationals", "Person"] },
  BORDERS_WITH: { out: ["borders", "Country"] },
  USES_CURRENCY: { out: ["currency", "Currency"] },
  LOCATED_IN: { out: ["located_in", "Municipality"], in: ["located_here", "Organization"] },
  IS_CAPITAL_OF: { out: ["capital_of", "Country"], in: ["capital", "Municipality"] },
  WITHIN: { out: ["within", "Country"], in: ["contains", "Municipality"] },
};

// Words seen to step into the related entity in real Cala queries (14-15 Nov 2026). The rest are hints;
// "education" on a Person was tried and returned the person, not the school.
const TESTED = new Set(["founders", "investors", "company", "ceo", "board_members"]);

const EXAMPLES = 3; // neighbours fetched per relationship: enough to learn the type and show examples
const MAX_TYPES = 16; // samples plus types discovered through their neighbours

type Neighbour = { id: string; name: string; entity_type: string };
type Intro = { properties?: string[]; relationships?: { outgoing?: string[]; incoming?: string[] } };
type Retrieved = { relationships?: { outgoing?: Record<string, Neighbour[]>; incoming?: Record<string, Neighbour[]> } };

let built: Record<string, EntitySchema> = {};
let building: Promise<void> | undefined;

/**
 * Schema of the entity type behind `id`: introspection names the properties and relationships, then one
 * retrieval of a few neighbours per relationship shows what each one really points to, with examples.
 */
async function sampleSchema(id: string): Promise<{ schema: EntitySchema; neighbours: Neighbour[] }> {
  const intro = (await calaTool("entity_introspection", { entity_id: id })) as Intro;
  const out = intro.relationships?.outgoing ?? [];
  const inc = intro.relationships?.incoming ?? [];
  const project = (rels: string[]) => Object.fromEntries(rels.map((r) => [r, { limit: EXAMPLES }]));
  let seenData: Retrieved = {};
  try {
    seenData = (await calaTool("entity_retrieval", {
      entity_id: id, properties: ["name"], relationships: { outgoing: project(out), incoming: project(inc) },
    })) as Retrieved;
  } catch {
    // Without retrieval the hand mapping still gives words and most types.
  }
  const relations: EntitySchema["relations"] = [];
  const neighbours: Neighbour[] = [];
  const words = new Set<string>();
  for (const [dir, rels] of [["outgoing", out], ["incoming", inc]] as const) {
    for (const rel of rels) {
      const mapped = dir === "outgoing" ? REL[rel]?.out : REL[rel]?.in;
      if (dir === "incoming" && !mapped) continue; // unmapped incoming names read wrongly from this side
      const word = mapped?.[0] ?? rel.toLowerCase();
      if (words.has(word)) continue;
      words.add(word);
      const found = (seenData.relationships?.[dir]?.[rel] ?? []).filter((n) => n?.name);
      neighbours.push(...found);
      // The type actually seen at the other end wins over the hand mapping.
      const counts = new Map<string, number>();
      for (const n of found) counts.set(n.entity_type, (counts.get(n.entity_type) ?? 0) + 1);
      const seenType = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      relations.push({
        word,
        rel: dir === "incoming" ? `${rel} (incoming)` : rel,
        type: seenType ?? mapped?.[1],
        tested: TESTED.has(word) || undefined,
        examples: [...new Set(found.map((n) => n.name))].slice(0, EXAMPLES),
      });
    }
  }
  return { schema: { properties: (intro.properties ?? []).filter((p) => p !== "id"), relations }, neighbours };
}

/**
 * The schema, waiting at most `waitMs` for it. From the disk cache it is ready in milliseconds; on a cold
 * cache the build keeps running in the background and the query box gets what is ready.
 */
export async function entitySchema(waitMs = 1500): Promise<Record<string, EntitySchema>> {
  const pending = startBuild();
  await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  return built;
}

function startBuild(): Promise<void> {
  building ??= (async () => {
    // 1. The hand-picked samples. 2. One neighbour of every other type they lead to (FundingRound,
    // CountrySubdivision, …), so stepping into those suggests real properties too.
    const discovered = new Map<string, string>();
    let missing = 0;
    await Promise.all(
      SAMPLES.map(async ([type, name]) => {
        try {
          // Same arguments as every other call site, so the cache is shared.
          const found = (await calaTool("entity_search", { name, entity_types: [type], limit: 3 })) as {
            entities?: { id: string; entity_type?: string }[];
          };
          const hit = found.entities?.[0];
          if (!hit?.id) return void missing++;
          const { schema, neighbours } = await sampleSchema(hit.id);
          built = { ...built, [hit.entity_type ?? type]: schema };
          for (const n of neighbours) if (n.id && !discovered.has(n.entity_type)) discovered.set(n.entity_type, n.id);
        } catch {
          missing++; // One type failing (rate limit, network) leaves the others usable.
        }
      }),
    );
    const extra = [...discovered].filter(([type]) => !built[type]).slice(0, Math.max(0, MAX_TYPES - Object.keys(built).length));
    // One at a time: Cala rejected these when fired in parallel. This runs in the background anyway.
    for (const [type, id] of extra) {
      try {
        built = { ...built, [type]: (await sampleSchema(id)).schema };
      } catch {
        // Skip a type that fails; it falls back to generic suggestions.
      }
    }
    if (missing) building = undefined; // retry the missing samples next time
  })();
  return building;
}
