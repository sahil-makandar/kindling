// The product name lives here and nowhere else.
export const APP_NAME = "Kindling";
export const TAGLINE = "Where strangers become regulars.";
export const REPO_URL = "https://github.com/sahil-makandar/kindling";

// Same values as the Tailwind tokens in app/globals.css.
// Exported for places CSS variables cannot reach, such as the poster PNG export.
export const COLORS = {
  paper: "#FFF7EC",
  card: "#FFFCF6",
  ink: "#2A211C",
  inkSoft: "#6A5B50",
  rule: "#EBD9C4",
  tomato: "#FF6B35",
  emberInk: "#B8420F",
  peach: "#FFD6B8",
  marigold: "#FFC845",
  sage: "#2D6A4F",
  inkBlue: "#2F4F8F",
  plum: "#8A3B5C",
} as const;
