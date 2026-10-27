import { qloo } from "@/src/qloo/endpoints";
import { tagsForFavourites } from "@/src/qloo/tags";
import { toVector, type TasteVector } from "@/src/seating/tasteVector";

// A guest's taste from the ids of their favourites. One Qloo call (cached by the sorted ids), or two when the tag
// lookup is unavailable and the favourites' own tags are read instead. Only ids go to Qloo, never names of people.
export async function tasteFor(favouriteIds: string[]): Promise<TasteVector> {
  const result = await tagsForFavourites(qloo, { favouriteIds: [...favouriteIds].sort() }, { purpose: "checkin.tags" });
  return toVector(result.tags);
}
