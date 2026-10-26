import { describe, expect, it } from "vitest";
import { APP_NAME, TAGLINE } from "@/src/config/brand";

describe("brand constants", () => {
  it("exports a name and a tagline", () => {
    expect(APP_NAME.length).toBeGreaterThan(0);
    expect(TAGLINE.length).toBeGreaterThan(0);
  });
});
