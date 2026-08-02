import { clamp } from '@/lib/math'
import { PANEL_MIN_HEIGHT } from '@/config/constants'

// Height redistribution for the drag handle between two stacked panels.
//
// Panels share their sidebar's height by flex-grow weight, but a drag arrives
// as a pixel delta. The pair's pixel heights and weights are captured at drag
// start, and the delta is converted back into a proportional weight change.
// Only the dragged pair is touched, which keeps every other panel's height
// exactly where the user left it.
//
// Pure, so the arithmetic (including the min-height clamp at both ends) is
// testable without a DOM. jsdom reports every height as 0.
export function redistribute(
  heightA: number,
  heightB: number,
  sizeSum: number,
  dy: number,
): [sizeA: number, sizeB: number] {
  const heightSum = heightA + heightB
  // Nothing to share out. Avoid dividing by zero.
  if (heightSum <= 0) return [sizeSum / 2, sizeSum / 2]

  // The clamp is what stops a drag collapsing either panel past its minimum;
  // when the pair is too short to give both a minimum, it settles at the
  // midpoint rather than inverting.
  const newHeightA = clamp(
    heightA + dy,
    Math.min(PANEL_MIN_HEIGHT, heightSum / 2),
    Math.max(heightSum - PANEL_MIN_HEIGHT, heightSum / 2),
  )
  const newSizeA = sizeSum * (newHeightA / heightSum)
  return [newSizeA, sizeSum - newSizeA]
}
