import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/src/config/brand";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the product name", () => {
  it("lives in src/config/brand.ts and nowhere else in app/ or src/", () => {
    const offenders = ["app", "src"]
      .flatMap(sourceFiles)
      .filter((file) => !file.split("\\").join("/").endsWith("src/config/brand.ts"))
      .filter((file) => readFileSync(file, "utf8").toLowerCase().includes(APP_NAME.toLowerCase()));
    expect(offenders).toEqual([]);
  });
});
