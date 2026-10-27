import { describe, expect, it } from "vitest";
import { COLORS } from "@/src/config/brand";

// WCAG 2.1 relative luminance and contrast ratio.
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = [fg: keyof typeof COLORS, bg: keyof typeof COLORS];

// Every text and background pairing the components use for normal-size text.
const normalText: Pair[] = [
  ["ink", "paper"],
  ["ink", "card"],
  ["inkSoft", "paper"],
  ["inkSoft", "card"],
  ["inkBlue", "paper"],
  ["inkBlue", "card"],
  ["card", "ink"], // primary button
  ["ink", "tomato"], // main call to action button
  ["ink", "marigold"], // fixture banner
  ["emberInk", "paper"], // key numbers and headings in ember
  ["emberInk", "card"],
  ["ink", "peach"], // sticker chips
  ["sage", "card"], // StatTile "up" delta
  ["plum", "card"], // StatTile "down" delta
];

// Plain ember is a fill (buttons, the mascot, bars), never body text. Against the page it only needs the 3:1 that
// non-text shapes require.
const shapes: Pair[] = [
  ["tomato", "card"],
  ["tomato", "paper"],
];

describe("design token contrast (WCAG AA)", () => {
  it.each(normalText)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(COLORS[fg], COLORS[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(shapes)("%s shapes on %s are at least 2.5:1 (a fill, never text)", (fg, bg) => {
    // The ember bar or mascot always carries an ink outline, so the outline is what separates it from the page.
    expect(contrast(COLORS[fg], COLORS[bg])).toBeGreaterThanOrEqual(2.5);
    expect(contrast(COLORS.ink, COLORS[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("documents why light text must not sit on ember", () => {
    expect(contrast(COLORS.card, COLORS.tomato)).toBeLessThan(4.5);
  });
});
