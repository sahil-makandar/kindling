// The venues and clubs this browser has opened, kept in localStorage. There is no login: a venue is yours if this browser made it.

export type RememberedVenue = {
  key: string;
  venueName: string;
  venueType: string;
  slowNight: string;
  runId: string | null;
  clubId: string | null;
  clubTitle: string | null;
  at: number;
};

const KEY = "kindling.venues";
const MAX = 12;

export function readRemembered(): RememberedVenue[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as RememberedVenue[]).filter((v) => typeof v?.key === "string" && typeof v?.venueName === "string") : [];
  } catch {
    return [];
  }
}

export function remember(entry: Omit<RememberedVenue, "at">): void {
  try {
    const rest = readRemembered().filter((v) => v.key !== entry.key);
    window.localStorage.setItem(KEY, JSON.stringify([{ ...entry, at: Date.now() }, ...rest].slice(0, MAX)));
  } catch {
    // Storage can be blocked. The app works the same without it.
  }
}

export function forgetRemembered(key: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readRemembered().filter((v) => v.key !== key)));
  } catch {
    // Nothing to do.
  }
}
