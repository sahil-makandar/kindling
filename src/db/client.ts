import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/src/config/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

// Keep one connection pool per process. In dev, hot reloads would otherwise open a new one each time.
const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  if (!globalForDb.__db) {
    // Neon's pooled connection string goes through PgBouncer, which does not support prepared statements.
    const sql = postgres(getEnv().DATABASE_URL, { prepare: false, max: 5 });
    globalForDb.__db = drizzle(sql, { schema });
  }
  return globalForDb.__db;
}

export { schema };
