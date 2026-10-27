import { describe, expect, it } from "vitest";
import { friendlyName, isColdName, NAMING_RULES } from "@/src/agent/naming";
import { DESIGNER_SYSTEM } from "@/src/agent/prompts/designer";
import { PRODUCER_SYSTEM } from "@/src/agent/prompts/producer";

describe("club names", () => {
  it("flags names that sound like a programme", () => {
    for (const name of ["The Billie Live Sound Session", "Ultimate Film Experience", "Vibes Collective", "Curated Listening Series", "Cinema Hub"]) expect(isColdName(name)).toBe(true);
  });

  it("lets warm names through", () => {
    for (const name of ["Ghibli and Ramen Tuesdays", "Slow Jams Supper Club", "The Wednesday Book Swap", "Pints and Pub Quiz"]) expect(isColdName(name)).toBe(false);
  });

  it("builds a plain name from what the club is about", () => {
    expect(friendlyName({ anchor: "Spirited Away", companion: "Tonkotsu Ramen", format: "discussion_club", night: "tuesday" })).toBe("Spirited Away and Tonkotsu Ramen Tuesdays");
    expect(friendlyName({ anchor: "Piranesi", companion: null, format: "book_club", night: null })).toBe("Piranesi Book Club");
    expect(isColdName(friendlyName({ anchor: "Billie Eilish", companion: null, format: "listening_night", night: null }))).toBe(false);
  });

  it("puts the naming rules, with good and bad examples, in both prompts", () => {
    expect(NAMING_RULES).toContain("Good:");
    expect(NAMING_RULES).toContain("Bad:");
    expect(DESIGNER_SYSTEM).toContain(NAMING_RULES);
    expect(PRODUCER_SYSTEM).toContain(NAMING_RULES);
  });
});
