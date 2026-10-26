import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Writing rules from CLAUDE.md section 10: no em or en dashes, none of the banned words, and no AI
// attribution lines in anything we ship. A line can opt out with the marker `lint-copy-ignore`,
// for the rare literal use (for example the word "journey" about a real trip).

export type Violation = { file: string; line: number; column: number; message: string };

const IGNORE_MARKER = "lint-copy-ignore";

const DASHES = /[–—]/g;

// Word families, matched as whole words and ignoring case.
const BANNED_WORDS = [
  "unlock(?:s|ed|ing)?",
  "unleash(?:es|ed|ing)?",
  "seamless(?:ly)?",
  "delv(?:e|es|ed|ing)",
  "elevat(?:e|es|ed|ing)",
  "empower(?:s|ed|ing|ment)?",
  "revolutioni[sz](?:e|es|ed|ing)",
  "game[- ]changers?",
  "cutting[- ]edge",
  "leverag(?:e|es|ed|ing)",
  "robust(?:ly|ness)?",
  "synerg(?:y|ies)",
  "tapestr(?:y|ies)",
  "journeys?",
];
const BANNED_WORD_PATTERN = new RegExp(`\\b(?:${BANNED_WORDS.join("|")})\\b`, "gi");

// Phrases that would claim AI authorship in shipped text.
const ATTRIBUTION_PATTERN = /\b(?:generated with|co-authored-by|built with ai|written by ai)\b/gi;

export function lintText(text: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((content, index) => {
    if (content.includes(IGNORE_MARKER)) return;
    const line = index + 1;

    for (const m of content.matchAll(DASHES)) {
      const name = m[0] === "—" ? "em dash" : "en dash";
      violations.push({
        file,
        line,
        column: (m.index ?? 0) + 1,
        message: `${name}: use a hyphen, comma, colon or full stop`,
      });
    }
    for (const m of content.matchAll(BANNED_WORD_PATTERN)) {
      violations.push({ file, line, column: (m.index ?? 0) + 1, message: `banned word "${m[0]}"` });
    }
    for (const m of content.matchAll(ATTRIBUTION_PATTERN)) {
      violations.push({ file, line, column: (m.index ?? 0) + 1, message: `AI attribution "${m[0]}"` });
    }
  });

  return violations;
}

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".md", ".mdx", ".css"]);

function collectFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return SCANNED_EXTENSIONS.has(path.extname(target)) ? [target] : [];
  return readdirSync(target).flatMap((name) => collectFiles(path.join(target, name)));
}

// Scans files and folders (relative to root) and returns every violation, plus how many files were read.
export function scanPaths(targets: string[], root: string): { violations: Violation[]; fileCount: number } {
  const violations: Violation[] = [];
  let fileCount = 0;
  for (const target of targets) {
    const full = path.join(root, target);
    try {
      statSync(full);
    } catch {
      continue;
    }
    for (const file of collectFiles(full)) {
      fileCount += 1;
      const relative = path.relative(root, file).split(path.sep).join("/");
      violations.push(...lintText(readFileSync(file, "utf8"), relative));
    }
  }
  return { violations, fileCount };
}
