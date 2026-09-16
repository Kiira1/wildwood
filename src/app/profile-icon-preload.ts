import { profileIconLocation } from "../../shared/profile-icons";
import { createImagePreloader, preloadImages } from "./image-preload";

export function createProfileIconPreloader() {
  const load = createImagePreloader();
  return (icons: readonly number[]) => load(icons.map(icon => profileIconLocation(icon).path));
}

export const preloadProfileIcons = (icons: readonly number[]) =>
  preloadImages(icons.map(icon => profileIconLocation(icon).path));
