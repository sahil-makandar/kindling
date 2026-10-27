import { seedDemo } from "@/src/demo/seed";

// Run with: npm run db:seed-demo           (builds the demo venue if it is missing)
//           npm run db:seed-demo -- --force (removes the old demo venue and builds it again)
async function main() {
  const result = await seedDemo({ force: process.argv.includes("--force"), log: (line) => console.log(line) });
  if (result.clubId) console.log(`Demo club: /clubs/${result.clubId}/weeks`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
