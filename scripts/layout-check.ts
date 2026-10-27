// Checks every page's layout with code, not pictures: horizontal overflow, clipped text, small tap targets and
// accessibility violations, at four widths. Run against a running app (npm run build && npm start, or npm run dev):
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/layout-check.ts http://localhost:3100
// Add --shots to save six screenshots to the git-ignored shots/ folder. They are saved, never opened here.
import AxeBuilder from "@axe-core/playwright";
import { desc, eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { getDb } from "@/src/db/client";
import { clubs, sessions, venues } from "@/src/db/schema";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3100";
const SHOTS = process.argv.includes("--shots");
const WIDTHS = [375, 768, 1280, 1600] as const;

type Finding = { page: string; width: number; kind: string; detail: string };
const findings: Finding[] = [];

async function targets(): Promise<Array<{ name: string; path: string }>> {
  const db = getDb();
  const [club] = await db.select({ id: clubs.id, runId: clubs.runId }).from(clubs).innerJoin(venues, eq(venues.id, clubs.venueId)).where(eq(venues.isDemo, true)).orderBy(desc(clubs.createdAt)).limit(1);
  const list = [
    { name: "landing", path: "/" },
    { name: "how", path: "/how" },
    { name: "venues", path: "/venues" },
    { name: "not-found", path: "/nope" },
  ];
  if (!club) return list;
  const [open] = await db.select({ code: sessions.checkInCode }).from(sessions).where(eq(sessions.clubId, club.id)).orderBy(desc(sessions.number)).limit(1);
  return [
    ...list,
    { name: "weekly", path: `/clubs/${club.id}/weeks` },
    { name: "kit", path: `/clubs/${club.id}` },
    { name: "live", path: `/clubs/${club.id}/live` },
    ...(club.runId ? [{ name: "picks", path: `/runs/${club.runId}/clubs` }, { name: "run", path: `/runs/${club.runId}?replay=1` }] : []),
    ...(open ? [{ name: "check-in", path: `/c/${open.code}` }] : []),
  ];
}

async function measure(page: Page, name: string, width: number) {
  const result = await page.evaluate((w) => {
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 3).join(".") : ""}`;
    const overflowing: string[] = [];
    const clipped: string[] = [];
    const small: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || el.closest(".leaflet-container, .sr-only, [aria-hidden='true'] svg")) continue;
      if (rect.right > w + 1 && !el.closest("[data-scroll], .overflow-x-auto")) overflowing.push(describe(el));
      const text = (el.textContent ?? "").trim();
      if (text && (style.overflow === "hidden" || style.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && !el.closest(".leaflet-container")) clipped.push(`${describe(el)} "${text.slice(0, 30)}"`);
      if (w <= 400 && (el.tagName === "A" || el.tagName === "BUTTON") && !el.closest("p, li > p, nav ol") && rect.height < 40 && text) small.push(`${describe(el)} "${text.slice(0, 24)}" ${Math.round(rect.height)}px`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, overflowing: [...new Set(overflowing)].slice(0, 5), clipped: [...new Set(clipped)].slice(0, 5), small: [...new Set(small)].slice(0, 5) };
  }, width);
  if (result.scrollWidth > width + 1) findings.push({ page: name, width, kind: "horizontal scroll", detail: `page is ${result.scrollWidth}px wide` });
  for (const d of result.overflowing) findings.push({ page: name, width, kind: "past the edge", detail: d });
  for (const d of result.clipped) findings.push({ page: name, width, kind: "clipped text", detail: d });
  for (const d of result.small) findings.push({ page: name, width, kind: "small tap target", detail: d });
}

async function main() {
  const pages = await targets();
  const browser = await chromium.launch();
  const shotList = SHOTS ? ["landing", "run", "picks", "kit", "weekly", "check-in"] : [];
  if (SHOTS) mkdirSync("shots", { recursive: true });

  for (const target of pages) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript("window.__name = (f) => f;");
      const response = await page.goto(`${BASE}${target.path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
      if (!response || (response.status() >= 400 && target.name !== "not-found")) {
        findings.push({ page: target.name, width, kind: "load failed", detail: `status ${response?.status() ?? "none"}` });
        await page.close();
        continue;
      }
      await page.waitForTimeout(700);
      await measure(page, target.name, width);
      if (width === 1280) {
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["color-contrast"]).analyze();
        for (const v of axe.violations) findings.push({ page: target.name, width, kind: `a11y ${v.impact}`, detail: `${v.id}: ${v.nodes.length} node(s), first ${v.nodes[0]?.target.join(" ")}` });
        const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
        for (const v of contrast.violations) findings.push({ page: target.name, width, kind: "contrast", detail: `${v.nodes.length} node(s), first ${v.nodes[0]?.target.join(" ")}` });
      }
      if (SHOTS && shotList.includes(target.name) && width === (target.name === "check-in" ? 375 : 1280)) {
        await page.screenshot({ path: `shots/${shotList.indexOf(target.name) + 1}-${target.name}.png`, fullPage: true });
      }
      await page.close();
    }
  }
  await browser.close();

  console.log(`Checked ${pages.length} pages at ${WIDTHS.join(", ")} px.`);
  if (findings.length === 0) console.log("No findings.");
  for (const f of findings) console.log(`${f.page} @${f.width}: ${f.kind}: ${f.detail}`);
  process.exit(0);
}

main();
