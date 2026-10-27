import type { CreateRunInput } from "./schema";

// One-tap examples for the landing form. The venues are made up; the coordinates are real street corners, so a preset
// skips the address lookup and always has data around it.
export type Preset = {
  id: string;
  label: string;
  input: Required<Pick<CreateRunInput, "name" | "address" | "venueType" | "slowNight" | "lat" | "lon" | "matchedAddress">>;
};

export const PRESETS: readonly Preset[] = [
  {
    id: "soho",
    label: "SoHo, New York",
    input: { name: "The Slow Pour (example)", address: "100 Crosby St, New York, NY", venueType: "cafe", slowNight: "tuesday", lat: 40.7246, lon: -73.9973, matchedAddress: "Crosby St, SoHo, New York, NY" },
  },
  {
    id: "east_austin",
    label: "East Austin",
    input: { name: "Lantern Taproom (example)", address: "E 6th St, Austin, TX", venueType: "brewery", slowNight: "monday", lat: 30.263, lon: -97.723, matchedAddress: "E 6th St, East Austin, TX" },
  },
  {
    id: "williamsburg",
    label: "Williamsburg, Brooklyn",
    input: { name: "Kent Ave Brewing (example)", address: "Kent Ave, Brooklyn, NY", venueType: "brewery", slowNight: "wednesday", lat: 40.7081, lon: -73.9571, matchedAddress: "Kent Ave, Williamsburg, Brooklyn, NY" },
  },
  {
    id: "logan_square",
    label: "Logan Square, Chicago",
    input: { name: "Milwaukee Ave Bar (example)", address: "N Milwaukee Ave, Chicago, IL", venueType: "bar", slowNight: "tuesday", lat: 41.9296, lon: -87.7083, matchedAddress: "N Milwaukee Ave, Logan Square, Chicago, IL" },
  },
];
