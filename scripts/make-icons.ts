// Draws the PNG app icons from the ember mark. Run once after the mark changes: npx tsx scripts/make-icons.ts
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("app/icon.svg", "utf8");
const SIZES: Array<[string, number]> = [["app/apple-icon.png", 180], ["public/icon-192.png", 192], ["public/icon-512.png", 512]];

async function main() {
  const browser = await chromium.launch();
  for (const [file, size] of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
    writeFileSync(file, await page.screenshot({ omitBackground: false }));
    await page.close();
  }
  await browser.close();
}
main();
