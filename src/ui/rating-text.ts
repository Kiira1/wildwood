import { formatCompactNumber } from "../../shared/compact-number";
import { RATING_MAX } from "../../shared/stat-rating";

/** A rating as players read it, like armor (Ryan): its number, compact past 1,000, and "Max" at the cap. */
export const formatRating = (rating: number) => rating >= RATING_MAX ? "Max"
  : rating >= 1_000 ? formatCompactNumber(rating) : Number(rating.toPrecision(3)).toString();
