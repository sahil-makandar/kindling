import { z } from "zod";

// The landing form's input, shared by the browser (inline errors) and the API route. No database imports here,
// so it is safe to bundle for the client.

export const VENUE_TYPES = ["cafe", "bookstore", "bar", "brewery", "restaurant", "music_venue", "community_space"] as const;
export const NIGHTS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export const VENUE_TYPE_LABEL: Record<(typeof VENUE_TYPES)[number], string> = {
  cafe: "Cafe",
  bookstore: "Bookstore",
  bar: "Bar",
  brewery: "Brewery",
  restaurant: "Restaurant",
  music_venue: "Music venue",
  community_space: "Community space",
};

export const NIGHT_LABEL: Record<(typeof NIGHTS)[number], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// lat and lon are given together when the person picked a preset, a different match from the address lookup, or a
// spot on the map; then the address is not looked up again.
export const createRunSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your venue's name.").max(80, "That name is too long."),
    address: z.string().trim().min(3, "Enter the venue's address.").max(200, "That address is too long."),
    venueType: z.enum(VENUE_TYPES, "Pick the kind of venue."),
    slowNight: z.enum(NIGHTS, "Pick your slowest night."),
    baselineHeadcount: z.number().int("Use a whole number.").min(0, "Use 0 or more.").max(1000, "That is more than we can plan for.").optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    matchedAddress: z.string().trim().max(300).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), { message: "Give both a latitude and a longitude, or neither.", path: ["lat"] });
export type CreateRunInput = z.infer<typeof createRunSchema>;
