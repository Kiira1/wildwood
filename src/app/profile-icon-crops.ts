export type ProfileIconCrop = { x: number; y: number; width: number; height: number };
export const OBJECT_ATLAS_SIZE = 1254;
export const OBJECT_ICON_FILL = .94;

// Measured artwork bounds, including detached details such as steam and stars.
// Generated artwork does not reliably stay inside equal 8×8 grid cells.
// These rectangles include a two-pixel gutter; saved avatar IDs stay unchanged.
const OBJECT_BOUNDS = [
  [14,31,154,140], [172,19,301,155], [326,13,451,154], [484,13,604,155], [639,20,763,146], [791,29,922,149], [946,20,1090,152], [1105,15,1236,156],
  [12,197,158,287], [187,169,294,314], [324,177,462,291], [480,188,615,295], [635,168,769,304], [795,182,918,295], [948,170,1082,306], [1111,167,1219,313],
  [12,329,158,459], [185,325,285,469], [315,314,463,463], [482,324,608,465], [629,318,763,467], [784,334,929,456], [957,326,1069,466], [1107,325,1236,464],
  [16,473,146,621], [171,486,297,619], [326,481,450,621], [490,484,597,621], [636,481,753,628], [793,489,916,617], [944,490,1087,621], [1100,479,1236,628],
  [14,642,148,779], [179,634,290,783], [320,635,461,785], [491,637,598,784], [638,633,759,785], [800,640,908,781], [937,651,1080,766], [1106,638,1236,780],
  [23,793,141,933], [163,808,305,931], [329,791,447,935], [465,816,618,918], [631,801,759,929], [808,787,894,940], [923,803,1103,928], [1132,791,1216,940],
  [14,971,150,1066], [170,947,301,1087], [311,945,461,1084], [479,947,609,1089], [640,944,761,1085], [796,950,910,1085], [950,943,1073,1092], [1110,959,1228,1076],
  [25,1092,145,1232], [175,1116,297,1230], [345,1102,431,1239], [472,1101,607,1232], [647,1098,746,1238], [782,1102,920,1234], [932,1120,1093,1234], [1111,1102,1226,1239],
] as const;

export const OBJECT_ICON_CROPS: readonly ProfileIconCrop[] = OBJECT_BOUNDS.map(([left, top, right, bottom]) => ({
  x: left - 2, y: top - 2, width: right - left + 4, height: bottom - top + 4,
}));

/** Normalized destination rectangle shared by CSS and canvas, with no stretching. */
export function containedIconRect(crop: ProfileIconCrop) {
  const scale = OBJECT_ICON_FILL / Math.max(crop.width, crop.height);
  const width = crop.width * scale, height = crop.height * scale;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
