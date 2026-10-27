import { z } from "zod";

// What the check-in page sends. Safe to bundle for the browser: no database imports.

export const FAVOURITE_DOMAINS = ["artist", "movie", "tv_show", "book", "podcast"] as const;
export type FavouriteDomain = (typeof FAVOURITE_DOMAINS)[number];

export const DOMAIN_NOUN: Record<FavouriteDomain, string> = {
  artist: "Music",
  movie: "Film",
  tv_show: "Show",
  book: "Book",
  podcast: "Podcast",
};

export const favouriteSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  domain: z.enum(FAVOURITE_DOMAINS),
});
export type FavouriteInput = z.infer<typeof favouriteSchema>;

// Control characters and angle brackets have no place in a first name, and the name is shown to the table.
const nickname = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Tell us what to call you.").max(30, "Keep it to 30 letters or fewer."));

export const FAVOURITE_COUNT = 3;

export const checkInSchema = z.object({
  code: z.string().trim().min(4, "That check-in code is not valid.").max(24, "That check-in code is not valid."),
  nickname,
  favourites: z
    .array(favouriteSchema)
    .length(FAVOURITE_COUNT, `Pick exactly ${FAVOURITE_COUNT} things you love.`)
    .refine((list) => new Set(list.map((f) => f.id)).size === list.length, { message: "Pick three different things." }),
  consentSeating: z.boolean(),
  remember: z.boolean(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const searchQuerySchema = z.string().trim().min(2, "Type at least two letters.").max(60, "That search is too long.");
