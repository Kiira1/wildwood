export function removeGreenPixels(pixels: Uint8ClampedArray, greenThreshold: number, ratio: number) {
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (green > greenThreshold && green > red * ratio && green > blue * ratio) pixels[index + 3] = 0;
  }
}
