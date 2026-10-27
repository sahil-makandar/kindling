import type { TableExplanation } from "./assignTables";

// Words for a table, safe to use in the browser and on the server.

// "You all love: Wong Kar-wai, city pop, ramen." Shared favourites first, then shared tags, at most three items.
// "You all love" only names things every person at the table has; otherwise the line says some of them share it.
export function sharedLine(explanation: TableExplanation | null): string | null {
  if (!explanation) return null;
  const items: Array<{ name: string; count: number }> = [];
  for (const fav of explanation.sharedFavourites) items.push(fav);
  for (const tag of explanation.sharedTags) if (!items.some((i) => i.name.toLowerCase() === tag.name.toLowerCase())) items.push(tag);
  const everyone = items.filter((i) => i.count >= explanation.size).map((i) => i.name);
  if (everyone.length > 0) return `You all love: ${everyone.slice(0, 3).join(", ")}.`;
  const some = items.map((i) => i.name).slice(0, 3);
  return some.length > 0 ? `Some of you share a love of: ${some.join(", ")}.` : null;
}
