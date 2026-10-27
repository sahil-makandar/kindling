import { describe, expect, it } from "vitest";
import { isSameKind, nearbyPlacesComponent, overlap, tagTokens, venueCrowdComponent, type TagUnit } from "@/src/scoring/localSignals";

const unit = (label: string, ...tags: string[]): TagUnit => ({ label, tags });

describe("tagTokens", () => {
  it("keeps taste words and drops words that name a kind of thing", () => {
    expect(tagTokens("Japanese restaurant")).toEqual(["japanese"]);
    expect(tagTokens("Live Music Venue")).toEqual(["live"]);
    expect(tagTokens("Bar")).toEqual([]);
  });
});

describe("overlap", () => {
  it("adds up the share of units that carry each of the club's words, capped at 1", () => {
    const units = [unit("A", "Japanese cuisine"), unit("B", "Japanese bakery"), unit("C", "Pizza"), unit("D", "Jazz bar")];
    const found = overlap(["Japanese cinema", "Jazz"], units);
    expect(found.matches.map((m) => m.token)).toEqual(["japanese", "jazz"]);
    expect(found.strength).toBeCloseTo(0.75, 5);
    expect(overlap(["Japanese", "Jazz", "pizza", "bakery"], units).strength).toBeLessThanOrEqual(1);
  });

  it("is zero when nothing matches", () => {
    expect(overlap(["Horror"], [unit("A", "Pizza")]).strength).toBe(0);
  });
});

describe("nearbyPlacesComponent", () => {
  const places = [unit("Ramen Co", "Japanese ramen"), unit("Book Nook", "Bookstore"), unit("Sip", "Coffee shop"), unit("Izakaya", "Japanese pub")];

  it("scores higher when places carry the club's words and when the club uses one of them", () => {
    const none = nearbyPlacesComponent({ clubName: "X", clubTags: ["Horror"], places, placeCompanion: null, callIds: [] });
    const words = nearbyPlacesComponent({ clubName: "X", clubTags: ["Japanese"], places, placeCompanion: null, callIds: ["c1"] });
    const both = nearbyPlacesComponent({ clubName: "X", clubTags: ["Japanese"], places, placeCompanion: "Ramen Co", callIds: ["c1"] });
    expect(words.value).toBeGreaterThan(none.value);
    expect(both.value).toBeGreaterThan(words.value);
    expect(both.reason).toContain("Ramen Co is one of the 4 places within 1 km");
    expect(none.reason).toContain("none of the 4 places within 1 km");
    expect(words.callIds).toEqual(["c1"]);
  });

  it("is a flagged neutral guess when Qloo returned no places", () => {
    expect(nearbyPlacesComponent({ clubName: "X", clubTags: ["Japanese"], places: [], placeCompanion: null, callIds: [] })).toMatchObject({ value: 0.4, flagged: true });
  });
});

describe("venueCrowdComponent", () => {
  it("reads the venue's own crowd when it is on Qloo", () => {
    const crowd = [unit("The Lantern Room", "Indie", "Jazz"), unit("Blue Note", "Jazz club")];
    const found = venueCrowdComponent({ venueName: "The Lantern Room", clubTags: ["Jazz"], crowd, standIn: [], callIds: ["c2"] });
    expect(found.value).toBeGreaterThan(0.9);
    expect(found.reason).toContain("The Lantern Room and venues like it on Qloo");
    expect(found.flagged).toBeUndefined();
  });

  it("falls back to places of the same kind, and says so", () => {
    const found = venueCrowdComponent({ venueName: "Fresh Cafe", clubTags: ["Jazz"], crowd: [], standIn: [unit("Beans", "Jazz coffee")], callIds: [] });
    expect(found.flagged).toBe(true);
    expect(found.reason).toContain("is not on Qloo, so places of the same kind nearby stand in");
  });

  it("is a neutral guess when there is nothing to read", () => {
    expect(venueCrowdComponent({ venueName: "Fresh Cafe", clubTags: ["Jazz"], crowd: [], standIn: [], callIds: [] })).toMatchObject({ value: 0.4, flagged: true });
  });

  it("gives different venues different answers for the same club", () => {
    const club = ["Craft beer", "Trivia"];
    const brewery = venueCrowdComponent({ venueName: "B", clubTags: club, crowd: [unit("Taproom", "Craft beer"), unit("Pub", "Beer garden trivia")], standIn: [], callIds: [] });
    const cafe = venueCrowdComponent({ venueName: "C", clubTags: club, crowd: [unit("Beans", "Espresso"), unit("Tea", "Matcha")], standIn: [], callIds: [] });
    expect(brewery.value).toBeGreaterThan(cafe.value);
  });
});

describe("isSameKind", () => {
  it("matches a place's categories to the venue type", () => {
    expect(isSameKind("cafe", ["Coffee shop"])).toBe(true);
    expect(isSameKind("brewery", ["Coffee shop"])).toBe(false);
    expect(isSameKind("brewery", ["Taproom", "Craft beer"])).toBe(true);
  });
});
