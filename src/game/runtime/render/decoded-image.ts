/**
 * The Town's big sheets, decoded off the main thread before they are first drawn. Drawn straight from an <img>,
 * Chrome decoded each one on the main thread the first time, all in the frame the Town appeared: about 0.6 s of a
 * mid phone's main thread for its six sheets. Kept by the image they came from.
 */
const decoded = new WeakMap<HTMLImageElement, ImageBitmap>();

/** What to draw for an image: its decoded copy once it has one, the image itself until then. */
export function decodedImage(image: HTMLImageElement): HTMLImageElement | ImageBitmap {
  return decoded.get(image) ?? image;
}

/** Decodes a loaded image into a bitmap off the main thread; resolves either way (a failure draws the image). */
export function decodeOffThread(image: HTMLImageElement): Promise<void> {
  if (typeof createImageBitmap !== "function" || decoded.has(image)) return Promise.resolve();
  return createImageBitmap(image).then(bitmap => { decoded.set(image, bitmap); }, () => {});
}

/** Gives a released image's bitmap back. */
export function releaseDecoded(image: HTMLImageElement) {
  decoded.get(image)?.close();
  decoded.delete(image);
}
