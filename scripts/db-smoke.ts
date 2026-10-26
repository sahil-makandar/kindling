// Inserts a venue, reads it back, then deletes it. Proves the database connection and migrations work.
// Run with: npm run db:smoke
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/src/db/client";

async function main() {
  const db = getDb();
  const [created] = await db
    .insert(schema.venues)
    .values({
      name: "Smoke Test Cafe",
      address: "1 Test Street",
      lat: 40.725,
      lon: -73.997,
      venueType: "cafe",
      slowNight: "tuesday",
      isDemo: true,
    })
    .returning();

  const [found] = await db.select().from(schema.venues).where(eq(schema.venues.id, created.id));
  console.log("Inserted and read back:", found.name, found.id);

  await db.delete(schema.venues).where(eq(schema.venues.id, created.id));
  console.log("Cleaned up the test row.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
