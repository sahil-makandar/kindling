import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintText, scanPaths } from "@/scripts/copy-lint";

const EM = "—";
const EN = "–";
const messages = (text: string) => lintText(text, "x.ts").map((v) => v.message);

describe("dashes", () => {
  it("flags an em dash", () => {
    expect(messages(`Find your people ${EM} every week`)).toEqual(["em dash: use a hyphen, comma, colon or full stop"]);
  });

  it("flags an en dash", () => {
    expect(messages(`Mon ${EN} Fri`)).toEqual(["en dash: use a hyphen, comma, colon or full stop"]);
  });

  it("allows plain hyphens", () => {
    expect(messages("A well-known, drop-in night - open to all")).toEqual([]);
  });

  it("reports line and column", () => {
    const [v] = lintText(`first line\nsecond ${EM} line`, "page.tsx");
    expect(v).toMatchObject({ file: "page.tsx", line: 2, column: 8 });
  });
});

describe("banned words", () => {
  it.each([
    "unlock",
    "Unlock your venue",
    "unlocked",
    "unleash",
    "seamless",
    "seamlessly",
    "delve",
    "delving",
    "elevate",
    "elevated",
    "empower",
    "empowering",
    "revolutionize",
    "revolutionise",
    "game-changer",
    "game changer",
    "cutting-edge",
    "cutting edge",
    "leverage",
    "leveraging",
    "robust",
    "synergy",
    "tapestry",
    "journey",
  ])("flags %s", (text) => {
    expect(messages(`This is ${text} copy.`).length).toBeGreaterThan(0);
  });

  it("ignores case", () => {
    expect(messages("A ROBUST plan")).toEqual(['banned word "ROBUST"']);
  });

  it("matches whole words only", () => {
    expect(messages("The journeyman unlockable elevator was delivered")).toEqual([]);
  });

  it("finds every banned word on a line", () => {
    expect(messages("A seamless, robust journey")).toHaveLength(3);
  });

  it("lets a line opt out with the ignore marker", () => {
    expect(messages("A real journey to Goa // lint-copy-ignore")).toEqual([]);
  });
});

describe("AI attribution", () => {
  it.each(["Generated with a tool", "Co-Authored-By: someone", "built with AI"])("flags %s", (text) => {
    expect(messages(text).length).toBeGreaterThan(0);
  });

  it("allows honest mentions of the language model", () => {
    expect(messages("The agent uses a language model to draft the kit.")).toEqual([]);
  });
});

describe("scanPaths", () => {
  function tempProject(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "copy-lint-"));
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(root, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }

  it("fails on a file containing an em dash and names the file and line", () => {
    const root = tempProject({ "app/page.tsx": `const a = 1;\nconst copy = "Hello ${EM} world";\n` });
    try {
      const { violations } = scanPaths(["app"], root);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "app/page.tsx", line: 2 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans nested folders and single files, and skips other file types and missing paths", () => {
    const root = tempProject({
      "src/deep/a.ts": "ok",
      "src/data.json": `{"x": "${EM}"}`,
      "README.md": "# Fine",
    });
    try {
      const { violations, fileCount } = scanPaths(["src", "README.md", "missing"], root);
      expect(violations).toEqual([]);
      expect(fileCount).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes on this repo", () => {
    const { violations, fileCount } = scanPaths(["app", "src", "README.md"], process.cwd());
    expect(fileCount).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
