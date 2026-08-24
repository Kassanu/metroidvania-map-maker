// The dither's geometry, in device pixels.
//
// Everything else under `src/canvas/` works in CSS pixels: the composable
// pre-scales the context by the device pixel ratio, so a renderer length is a
// CSS length and the backing store is somebody else's problem. The checker
// pattern is the exception. Its square has to land on whole device pixels or a
// fractional zoom bands it across the cell, and its legibility floor is an
// apparent size rather than a stored one.
//
// So these take the ratio as a parameter. Nothing in this file reads `window`,
// which is what keeps the renderer testable at any ratio without a global.
//
// The floor test uses the unrounded squares-per-cell and the square size uses
// the rounded one. That is deliberate: the floor asks whether a square would be
// under an apparent pixel, which is a question about the true size, while the
// square that gets drawn is the rounded one.

// One cell's size in device pixels. `tileSize * zoom` is its CSS size, which is
// the only place either value is used.
export function cellDevicePx(tileSize: number, zoom: number, dpr: number): number {
  return tileSize * zoom * dpr
}

// Nominally eight squares per cell edge, which is one map pixel per square
// against a reference cell of eight. Nominal between round zooms and exact
// whenever the cell is a whole multiple of eight device pixels.
export const SQUARES_PER_CELL = 8

// At least one device pixel, which is what stops a rounded square reaching zero
// and handing `createPattern` a tile with no area. It is reachable: at a
// fractional ratio a cell of four device pixels clears the floor below and
// rounds to nothing.
export function checkerSquarePx(cell: number): number {
  return Math.max(1, Math.round(cell / SQUARES_PER_CELL))
}

// Below one CSS pixel per square the checker stops reading as a pattern, so it
// is replaced by a flat blend of its two colours. The floor is in CSS pixels
// rather than device pixels because legibility is an apparent size: a
// device-pixel floor would fire at half the apparent size on a retina display.
//
// The ratio cancels, so the crossover is a zoom rather than a zoom and a
// display: at `tileSize` 32 it is 25% everywhere.
export function flattensToBlend(cell: number, dpr: number): boolean {
  return cell / SQUARES_PER_CELL < dpr
}

// A CSS-pixel coordinate moved to the nearest whole device pixel, answered back
// in CSS pixels so a caller in renderer space can use it directly. What keeps
// the pattern origin on the pixel grid and the liquid's fill line hard instead
// of antialiased into a blended row.
export function snapToDevicePixel(cssPx: number, dpr: number): number {
  return Math.round(cssPx * dpr) / dpr
}
