import type { ComponentName } from "@/src/scoring/clubScore";

// Plain-language labels for the "How we know" panel. Pure, so the wording is tested.

export const COMPONENT_LABEL: Record<ComponentName, string> = {
  localAffinity: "Loved around here",
  coherence: "Fits together",
  venueFit: "Fits your venue",
  momentum: "Rising now",
  sweetSpot: "Known but not too common",
  formatFit: "Right kind of night",
};

export const COMPONENT_HELP: Record<ComponentName, string> = {
  localAffinity: "How strongly people near the venue favour the anchor, ranked against everything else Qloo returned for the area.",
  coherence: "Whether the anchor and its companions really belong together, checked with a separate Qloo call.",
  venueFit: "Whether people who already like places like yours also like the anchor.",
  momentum: "Whether the anchor is rising in the area right now.",
  sweetSpot: "Popular enough to draw a crowd, niche enough to feel like an identity.",
  formatFit: "How well the format suits this kind of venue. This one is a rule, not a Qloo call.",
};

const PARAM_LABEL: Record<string, string> = {
  "filter.type": "Looking for",
  "signal.location": "Around",
  "signal.location.radius": "Radius",
  "signal.location.query": "City",
  "signal.interests.entities": "Starting from",
  "signal.interests.tags": "Starting from tags",
  "filter.tags": "Only tagged",
  "filter.popularity.max": "Popularity cap",
  "filter.popularity.min": "Popularity floor",
  "filter.parents.types": "Place type",
  take: "Results asked for",
  limit: "Results asked for",
  query: "Search text",
};

export type ParamLine = { label: string; value: string };

function readValue(key: string, value: unknown): string {
  const text = Array.isArray(value) ? value.join(",") : String(value);
  if (key === "filter.type" || key === "filter.parents.types") return text.split(",").map((t) => t.replace(/^urn:(entity|tag):/, "").replace(/_/g, " ")).join(", ");
  if (key === "signal.location") {
    const match = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(text);
    return match ? `${Number(match[2]).toFixed(4)}, ${Number(match[1]).toFixed(4)}` : text;
  }
  if (key === "signal.location.radius") return `${text} m`;
  if (key === "signal.interests.entities" || key === "signal.interests.tags" || key === "filter.tags") {
    const count = text.split(",").filter(Boolean).length;
    return `${count} ${key === "filter.tags" || key === "signal.interests.tags" ? "tag" : "entit"}${key === "signal.interests.entities" ? (count === 1 ? "y" : "ies") : count === 1 ? "" : "s"}`;
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// The call's query parameters in words. The API key travels in a header, never in these.
export function describeParams(params: unknown): ParamLine[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  return Object.entries(params as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ label: PARAM_LABEL[key] ?? key, value: readValue(key, value) }));
}

export function statusLabel(status: number): { text: string; ok: boolean } {
  return status >= 200 && status < 300 ? { text: `${status} OK`, ok: true } : { text: String(status), ok: false };
}

export function resultsLabel(count: number | null): string {
  if (count === null) return "no count";
  return count === 1 ? "1 result" : `${count} results`;
}

export const formatScore = (score: number | null): string => (score === null ? "n/a" : String(Math.round(score)));
