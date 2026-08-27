// The largest bitmap this device can actually produce, measured rather than
// assumed.
//
// A canvas past the browser's limits does not throw. It yields a blank bitmap
// or a null blob, so the size has to be judged before anything is allocated,
// and the number to judge it against differs by engine, by device and by
// version. One pinned constant would have to be the worst device the app
// supports, which sizes a desktop export by a phone.
//
// The ceiling is two numbers because engines cap two things. A dimension cap
// and an area cap are different limits with different values, and a request can
// pass one while failing the other: 65536x4000 is under every published area
// cap and over every dimension cap. Probing squares measures one side that
// works, which is evidence for both.
//
// Measured once per session and held in memory. Persisting it would outlive a
// browser update or a move to another device, and a stored ceiling that looks
// authoritative is worse than measuring again.

export interface ImageCeiling {
  // The largest square side that allocated and read back, in pixels. Both the
  // width and the height of a request must be within it.
  maxSide: number
  // `maxSide` squared. A request's total pixel count must be within it, which
  // is the constraint an unequal request can fail while both its sides pass.
  maxPixels: number
}

// Ascending, and capped where it is because the largest plausible request is
// far below the top: a 100-cell map at the largest size preset is about 13,000
// pixels. The next step up would be a four-gigabyte allocation performed for no
// request that could reach it.
export const CEILING_STEPS = [1024, 2048, 4096, 8192, 16384] as const

// Small enough that it must succeed anywhere a canvas works at all. Its job is
// to tell a device that cannot allocate from an instrument that cannot measure.
const CONTROL_SIDE = 16

// What the ceiling is when the probe cannot measure. The smallest area cap
// among the engines the app targets, so it is safe on all of them.
//
// Reached when the control probe fails, which means the readback is lying
// rather than the allocation failing: canvas readback can be blocked or noised
// independently of allocation, and a browser hardened that way would otherwise
// read as "even the smallest step failed" and refuse every export forever. A
// check that cannot pass is as useless as one that cannot fail.
export const FALLBACK_MAX_SIDE = 4096

// The stepper, with allocation handed in. Every branch here is reachable from a
// test because the thing that cannot be simulated is the argument.
export function probeCeiling(canAllocate: (side: number) => boolean): ImageCeiling {
  if (!canAllocate(CONTROL_SIDE)) return ceilingOf(FALLBACK_MAX_SIDE)

  let largest = CONTROL_SIDE
  for (const side of CEILING_STEPS) {
    if (!canAllocate(side)) break
    largest = side
  }
  return ceilingOf(largest)
}

export function withinCeiling(
  size: { width: number; height: number },
  ceiling: ImageCeiling,
): boolean {
  if (size.width > ceiling.maxSide || size.height > ceiling.maxSide) return false
  return size.width * size.height <= ceiling.maxPixels
}

let measured: ImageCeiling | null = null

export function imageCeiling(): ImageCeiling {
  measured ??= probeCeiling(canAllocateSquare)
  return measured
}

function ceilingOf(maxSide: number): ImageCeiling {
  return { maxSide, maxPixels: maxSide * maxSide }
}

// Allocation is judged by reading a pixel back, because that is the only signal
// an over-large canvas gives: it reports the size it was asked for and paints
// nothing. The far corner is the one that a clamped allocation loses first.
//
// Alpha alone, and against zero rather than against the colour written, so a
// browser that adds noise to readback still reads as a success. A failed
// allocation gives all zeroes.
function canAllocateSquare(side: number): boolean {
  const canvas = document.createElement('canvas')
  try {
    canvas.width = side
    canvas.height = side
    if (canvas.width !== side || canvas.height !== side) return false

    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(side - 1, side - 1, 1, 1)
    return ctx.getImageData(side - 1, side - 1, 1, 1).data[3] !== 0
  } catch {
    // An engine that refuses the allocation outright rather than clamping it.
    return false
  } finally {
    // Released here rather than left to collection: the probe walks up to the
    // largest size the device takes, and holding those while stepping is the
    // allocation this is trying to measure.
    canvas.width = 0
    canvas.height = 0
  }
}
