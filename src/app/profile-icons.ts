import { PROFILE_ICON_GRID, PROFILE_ICON_SHEETS, profileIconLocation } from "../../shared/profile-icons";

const ZOOM = 1.03;
const POSITION_STEP = ZOOM / (PROFILE_ICON_GRID * ZOOM - 1) * 100;
const POSITION_START = (ZOOM - 1) / 2 / (PROFILE_ICON_GRID * ZOOM - 1) * 100;

export function applyProfileIcon(element: HTMLElement, iconIndex: number) {
  const icon = profileIconLocation(iconIndex);
  element.style.backgroundImage = `url("${icon.path}")`;
  element.style.backgroundRepeat = "no-repeat";
  element.style.backgroundSize = `${PROFILE_ICON_GRID * ZOOM * 100}% ${PROFILE_ICON_GRID * ZOOM * 100}%`;
  element.style.backgroundPosition = `${POSITION_START + icon.column * POSITION_STEP}% ${POSITION_START + icon.row * POSITION_STEP}%`;
  element.dataset.profileIcon = String(icon.index);
}

/** Canvas portraits use the same atlas coordinates as DOM portraits. Load each sheet once, on demand. */
export function createProfileIconCanvasPainter(onSheetLoaded: () => void) {
  const sheets = new Map<number, HTMLImageElement>();
  return (canvas: HTMLCanvasElement, iconIndex: number) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const icon = profileIconLocation(iconIndex);
    let sheet = sheets.get(icon.sheetIndex);
    if (!sheet) {
      sheet = new Image(); sheets.set(icon.sheetIndex, sheet);
      sheet.addEventListener("load", onSheetLoaded);
      sheet.src = PROFILE_ICON_SHEETS[icon.sheetIndex].path;
    }
    if (!sheet.complete || !sheet.naturalWidth) return;
    const width = sheet.naturalWidth / PROFILE_ICON_GRID, height = sheet.naturalHeight / PROFILE_ICON_GRID;
    const insetX = width * (1 - 1 / ZOOM) / 2, insetY = height * (1 - 1 / ZOOM) / 2;
    context.imageSmoothingEnabled = true;
    context.drawImage(sheet, icon.column * width + insetX, icon.row * height + insetY, width / ZOOM, height / ZOOM, 0, 0, canvas.width, canvas.height);
  };
}
