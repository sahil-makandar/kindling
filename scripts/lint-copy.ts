// Run with: npm run lint:copy
// Checks app/, src/ and README.md against the writing rules (no dashes, no banned words, no AI attribution).
import { scanPaths } from "./copy-lint";

const { violations, fileCount } = scanPaths(["app", "src", "README.md"], process.cwd());

if (violations.length > 0) {
  for (const v of violations) console.error(`${v.file}:${v.line}:${v.column}  ${v.message}`);
  console.error(`\nlint:copy found ${violations.length} problem${violations.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`lint:copy: ${fileCount} files clean.`);
