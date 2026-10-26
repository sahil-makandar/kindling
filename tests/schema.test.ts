import { getTableName, isTable, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/src/db/schema";

// Table names from docs/PRODUCT_SPEC.md section 7, plus geocode_cache from BUILD_PLAN F4.
const expected = [
  "venues",
  "runs",
  "trace_events",
  "qloo_calls",
  "signals",
  "candidates",
  "baselines",
  "clubs",
  "sessions",
  "attendees",
  "checkins",
  "recommendations",
  "qloo_cache",
  "rate_limits",
  "geocode_cache",
];

describe("database schema", () => {
  it("defines every table in the spec", () => {
    const exports: unknown[] = Object.values(schema);
    const actual = exports
      .filter((v): v is Table => isTable(v))
      .map((t) => getTableName(t))
      .sort();
    expect(actual).toEqual([...expected].sort());
  });

  it("lists run stages in pipeline order", () => {
    expect(schema.RUN_STAGES).toEqual(["locate", "scout", "design", "verify", "baseline", "done"]);
  });
});
