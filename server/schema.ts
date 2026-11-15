// Query-box schema: per entity type, its properties and the related entities you can step into.
// Built from Cala entity introspection of one well-known entity per type, through the cached Cala calls.
import type { EntitySchema } from "../shared/types.ts";
import { calaTool } from "./cala.ts";

/** One well-known entity per type to introspect. Introspection is per entity, Cala has no type-level schema. */
const SAMPLES: [type: string, name: string][] = [
  ["Company", "Stripe"],
  ["Person", "Patrick Collison"],
  ["Industry", "Fintech"],
  ["Country", "Finland"],
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
};

// Words seen to step into the related entity in real Cala queries (14-15 Nov 2026). The rest are hints;
// "education" on a Person was tried and returned the person, not the school.
const TESTED = new Set(["founders", "investors", "company", "ceo", "board_members"]);

let built: Record<string, EntitySchema> = {};
let building: Promise<void> | undefined;

async function introspect(type: string, name: string): Promise<EntitySchema | undefined> {
  // Same arguments as every other call site, so the disk cache is shared.
  const found = (await calaTool("entity_search", { name, entity_types: [type], limit: 3 })) as { entities?: { id: string }[] };
  const id = found.entities?.[0]?.id;
  if (!id) return undefined;
  const intro = (await calaTool("entity_introspection", { entity_id: id })) as {
    properties?: string[];
    relationships?: { outgoing?: string[]; incoming?: string[] };
  };
  const relations: EntitySchema["relations"] = [];
  const seen = new Set<string>();
  const add = (word: string, rel: string, target?: string) => {
    if (seen.has(word)) return;
    seen.add(word);
    relations.push({ word, rel, type: target, tested: TESTED.has(word) || undefined });
  };
  for (const rel of intro.relationships?.outgoing ?? []) add(REL[rel]?.out?.[0] ?? rel.toLowerCase(), rel, REL[rel]?.out?.[1]);
  for (const rel of intro.relationships?.incoming ?? []) {
    const m = REL[rel]?.in;
    if (m) add(m[0], `${rel} (incoming)`, m[1]); // unmapped incoming names read wrongly from this side, so skip them
  }
  return { properties: (intro.properties ?? []).filter((p) => p !== "id"), relations };
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
  building ??= Promise.all(
    SAMPLES.map(async ([type, name]) => {
      try {
        const schema = await introspect(type, name);
        if (schema) built = { ...built, [type]: schema };
      } catch {
        // One type failing (rate limit, network) leaves the others usable.
      }
    }),
  ).then(() => {
    if (Object.keys(built).length < SAMPLES.length) building = undefined; // retry the missing ones next time
  });
  return building;
}
