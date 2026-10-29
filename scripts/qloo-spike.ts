// Live probe of the Qloo API. Run with: npm run qloo:spike
// Calls every capability Kindling relies on for the four spike locations and prints a compact table.
// Raw responses are saved to fixtures/live/, which is git-ignored: Qloo response data must never be committed.
// The API key is read from the environment and only ever sent as a header; it is never printed.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createQlooClient, QlooError } from "@/src/qloo/client";
import { createMemoryStore } from "@/src/qloo/store";
import { pointWkt } from "@/src/qloo/endpoints";
import { countResults, parseEntityResults, parseTagResults, parseSearchResults } from "@/src/qloo/schemas";

const key = process.env.QLOO_API_KEY;
if (!key) {
  console.error("QLOO_API_KEY is not set in .env.local");
  process.exit(1);
}

const client = createQlooClient({
  mode: "record",
  baseUrl: process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com",
  apiKey: key,
  store: createMemoryStore(),
});

const LOCATIONS = {
  soho: { label: "SoHo, New York", lon: -73.9973, lat: 40.7246, city: "New York" },
  east_austin: { label: "East Austin", lon: -97.723, lat: 30.263, city: "Austin" },
  williamsburg: { label: "Williamsburg", lon: -73.9571, lat: 40.7081, city: "New York" },
  logan_square: { label: "Logan Square, Chicago", lon: -87.7083, lat: 41.9296, city: "Chicago" },
} as const;
type LocKey = keyof typeof LOCATIONS;

type Row = {
  call: string;
  status: number | string;
  ms: number;
  count: number | null;
  top: string;
  names: string[];
  ids: string[];
};
const rows: Row[] = [];
const rawByLabel = new Map<string, unknown>();

type Params = Record<string, string | number | boolean | undefined>;

async function probe(label: string, endpoint: string, params: Params, kind: "entities" | "tags" | "search" | "other" = "entities"): Promise<Row & { data: unknown }> {
  const started = Date.now();
  let row: Row & { data: unknown };
  try {
    const res = await client.get(endpoint, params, { purpose: "spike" });
    const items =
      kind === "entities" ? parseEntityResults(res.data).items
      : kind === "search" ? parseSearchResults(res.data).items
      : kind === "tags" ? parseTagResults(res.data).items
      : [];
    const names = items.map((i) => i.name);
    const top = items
      .slice(0, 3)
      .map((i) => `${i.name}${"affinity" in i && i.affinity !== undefined ? ` (${Number(i.affinity).toFixed(2)})` : ""}`)
      .join(", ");
    row = { call: label, status: res.status, ms: res.ms, count: countResults(res.data), top, names, ids: items.map((i) => ("id" in i ? String(i.id) : "")), data: res.data };
  } catch (e) {
    const status = e instanceof QlooError ? e.status : "ERR";
    row = { call: label, status, ms: Date.now() - started, count: null, top: e instanceof Error ? e.message.slice(0, 60) : "error", names: [], ids: [], data: null };
  }
  rows.push(row);
  rawByLabel.set(label, row.data);
  console.log(`${String(row.status).padEnd(4)} ${String(row.ms).padStart(5)}ms n=${String(row.count ?? "-").padEnd(3)} ${label.padEnd(46)} ${row.top.slice(0, 70)}`);
  return row;
}

// Describes the shape of a value (keys and types, never the values) so it can be written up without any Qloo data.
function shape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${shape(value[0], depth + 1)}] x${value.length}`;
  if (value && typeof value === "object") {
    if (depth > 3) return "{...}";
    return `{ ${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`).join(", ")} }`;
  }
  return value === null ? "null" : typeof value;
}

const jaccard = (a: string[], b: string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  const shared = [...x].filter((n) => y.has(n)).length;
  return x.size + y.size - shared === 0 ? 0 : shared / (x.size + y.size - shared);
};

const DOMAINS = ["artist", "movie", "tv_show", "book", "podcast", "video_game"] as const;
const area = (l: (typeof LOCATIONS)[LocKey], radius: number | string) => ({
  "signal.location": pointWkt(l.lon, l.lat),
  "signal.location.radius": radius,
});

async function main() {
  const shapes: Record<string, string> = {};
  const summary: Record<string, unknown> = {};

  console.log("\n=== 1. Area taste per domain at 1500 (assumed metres), per location ===");
  const firstIds: Record<string, string[]> = {};
  const byLoc: Record<string, Record<string, string[]>> = {};
  for (const [lk, loc] of Object.entries(LOCATIONS)) {
    byLoc[lk] = {};
    for (const domain of DOMAINS) {
      const r = await probe(`${lk} ${domain} r=1500`, "/v2/insights", { "filter.type": `urn:entity:${domain}`, ...area(loc, 1500), take: 15 });
      byLoc[lk][domain] = r.names;
      if (domain === "movie") firstIds[lk] = r.ids.slice(0, 5);
      if (lk === "soho" && domain === "movie") shapes["insights entities"] = shape(r.data);
    }
  }

  console.log("\n=== 2. Radius unit: movie in SoHo at 1.5, 15, 150, 1500, 15000 ===");
  const radiusNames: Record<string, string[]> = {};
  for (const r of [1.5, 15, 150, 1500, 15000]) {
    const row = await probe(`soho movie r=${r}`, "/v2/insights", { "filter.type": "urn:entity:movie", ...area(LOCATIONS.soho, r), take: 15 });
    radiusNames[String(r)] = row.names;
  }
  summary.radiusOverlapWith1500 = Object.fromEntries(Object.entries(radiusNames).map(([r, n]) => [r, Number(jaccard(n, radiusNames["1500"]).toFixed(2))]));

  console.log("\n=== 3. How different are SoHo and Williamsburg at small radii? (Jaccard of top 15 names) ===");
  const compare: Record<string, Record<string, number>> = {};
  for (const domain of ["movie", "artist", "tv_show"] as const) {
    compare[domain] = {};
    for (const radius of [250, 500, 1000, 1500, 3000]) {
      const a = await probe(`soho ${domain} r=${radius}`, "/v2/insights", { "filter.type": `urn:entity:${domain}`, ...area(LOCATIONS.soho, radius), take: 15 });
      const b = await probe(`williamsburg ${domain} r=${radius}`, "/v2/insights", { "filter.type": `urn:entity:${domain}`, ...area(LOCATIONS.williamsburg, radius), take: 15 });
      compare[domain][String(radius)] = Number(jaccard(a.names, b.names).toFixed(2));
    }
  }
  summary.sohoVsWilliamsburgOverlap = compare;

  console.log("\n=== 4. Unlisted filter types: urn:tag and urn:heatmap ===");
  for (const [lk, loc] of Object.entries(LOCATIONS)) {
    const t = await probe(`${lk} urn:tag area r=1500`, "/v2/insights", { "filter.type": "urn:tag", ...area(loc, 1500), take: 25 }, "tags");
    if (lk === "soho") shapes["insights tags (area)"] = shape(t.data);
  }
  const favIds = firstIds.soho ?? [];
  const tagFav = await probe("urn:tag from 3 favourites", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": favIds.slice(0, 3).join(","), take: 25 }, "tags");
  shapes["insights tags (favourites)"] = shape(tagFav.data);
  const heat = await probe("soho urn:heatmap", "/v2/insights", {
    "filter.type": "urn:heatmap",
    "signal.interests.entities": favIds[0],
    "filter.location": pointWkt(LOCATIONS.soho.lon, LOCATIONS.soho.lat),
    "filter.location.radius": 8000,
  }, "other");
  shapes["insights heatmap"] = shape(heat.data);

  console.log("\n=== 5. Trends, places, city-level, explainability, bad parameter ===");
  for (const lk of ["soho", "williamsburg"] as const) {
    await probe(`${lk} artist trending r=1500`, "/v2/insights", { "filter.type": "urn:entity:artist", ...area(LOCATIONS[lk], 1500), "bias.trends": "high", take: 15 });
  }
  const places = await probe("soho places r=1500", "/v2/insights", {
    "filter.type": "urn:entity:place",
    "filter.location": pointWkt(LOCATIONS.soho.lon, LOCATIONS.soho.lat),
    "filter.location.radius": 1500,
    ...area(LOCATIONS.soho, 1500),
    take: 20,
  });
  shapes["insights places"] = shape(places.data);
  for (const lk of ["williamsburg", "logan_square", "east_austin"] as const) {
    await probe(`${lk} places r=1500`, "/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.location": pointWkt(LOCATIONS[lk].lon, LOCATIONS[lk].lat),
      "filter.location.radius": 1500,
      ...area(LOCATIONS[lk], 1500),
      take: 20,
    });
  }
  for (const lk of ["soho", "logan_square", "east_austin"] as const) {
    await probe(`${lk} movie city query "${LOCATIONS[lk].city}"`, "/v2/insights", { "filter.type": "urn:entity:movie", "signal.location.query": LOCATIONS[lk].city, take: 15 });
  }
  await probe('soho movie neighbourhood query "SoHo"', "/v2/insights", { "filter.type": "urn:entity:movie", "signal.location.query": "SoHo", take: 15 });
  const expl = await probe("soho movie explainability", "/v2/insights", { "filter.type": "urn:entity:movie", ...area(LOCATIONS.soho, 1500), "feature.explainability": true, take: 5 });
  shapes["explainability"] = shape(expl.data);
  const bogus = await probe("soho movie + bogus parameter", "/v2/insights", { "filter.type": "urn:entity:movie", ...area(LOCATIONS.soho, 1500), "signal.bogus.thing": "1", take: 5 });
  summary.bogusParameterStatus = bogus.status;

  console.log("\n=== 6. Search, entities, tags ===");
  const venues: Record<string, string> = {};
  for (const [name, query] of [["soho", "Crosby Street Hotel New York"], ["williamsburg", "Output Brooklyn"], ["austin", "Quack's 43rd Street Bakery Austin"], ["chicago", "Fatherland Coffee Chicago"]] as const) {
    const s = await probe(`search place "${query}"`, "/search", { query, types: "urn:entity:place", take: 8 }, "search");
    venues[name] = s.ids[0] ?? "";
    if (name === "soho") shapes["search place"] = shape(s.data);
  }
  const multi = await probe("search multi-type 'Spirited'", "/search", { query: "Spirited", types: "urn:entity:movie,urn:entity:tv_show,urn:entity:book", take: 8 }, "search");
  summary.searchMultiTypeStatus = multi.status;
  await probe("search single type movie 'Spirited'", "/search", { query: "Spirited Away", types: "urn:entity:movie", take: 5 }, "search");
  await probe("search no types 'Spirited'", "/search", { query: "Spirited Away", take: 5 }, "search");
  const ents = await probe("entities by id (3 movies)", "/entities", { entity_ids: favIds.slice(0, 3).join(",") }, "search");
  shapes["entities"] = shape(ents.data);
  const tagq = await probe("tags query 'jazz'", "/v2/tags", { "filter.query": "jazz" }, "tags");
  shapes["v2/tags"] = shape(tagq.data);

  console.log("\n=== 7. Venue crowd, scoring a list, comparison ===");
  const venueId = venues.williamsburg || venues.soho;
  if (venueId) {
    const crowd = await probe("venue crowd movie (search hit as signal)", "/v2/insights", { "filter.type": "urn:entity:movie", "signal.interests.entities": venueId, take: 15 });
    summary.venueCrowdCount = crowd.count;
  }
  const anchor = favIds[0];
  const companions = (byLoc.soho.artist ?? []).length ? [] : [];
  const artistRow = rows.find((r) => r.call === "soho artist r=1500");
  const companionIds = artistRow?.ids.slice(0, 5) ?? [];
  if (anchor && companionIds.length) {
    const score = await probe("scoreList artists given a movie anchor", "/v2/insights", {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": anchor,
      "filter.results.entities": companionIds.join(","),
    });
    shapes["scoreList"] = shape(score.data);
    await probe("scoreList artists by area (no anchor)", "/v2/insights", {
      "filter.type": "urn:entity:artist",
      ...area(LOCATIONS.soho, 1500),
      "filter.results.entities": companionIds.join(","),
    });
  }
  void companions;
  for (const p of [
    { "filter.type": "urn:tag", "a.signal.interests.entities": favIds[0], "b.signal.interests.entities": favIds[1] },
    { "filter.type": "urn:tag", "signal.interests.entities": favIds[0], "compare.signal.interests.entities": favIds[1] },
  ]) {
    await probe(`compare variant ${Object.keys(p).slice(1).join("+")}`, "/v2/analysis/compare", p, "tags");
  }

  // ---------- findings ----------
  const ok = rows.filter((r) => r.status === 200);
  const latencies = ok.map((r) => r.ms).sort((a, b) => a - b);
  summary.calls = rows.length;
  summary.statusCounts = rows.reduce<Record<string, number>>((acc, r) => ((acc[String(r.status)] = (acc[String(r.status)] ?? 0) + 1), acc), {});
  summary.latencyMs = { median: latencies[Math.floor(latencies.length / 2)], p90: latencies[Math.floor(latencies.length * 0.9)], max: latencies.at(-1) };
  summary.shapes = shapes;

  const dir = path.join(process.cwd(), "fixtures", "live");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "spike-summary.json"), JSON.stringify({ summary, rows: rows.map((row) => ({ ...row, names: undefined, ids: undefined })) }, null, 2));

  console.log("\n=== SUMMARY (no response bodies) ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
