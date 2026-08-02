// The "page": the visual window drawn over the map's content.
//
// The grid itself is unbounded: this is presentation, not structure.
// Rendering infinite emptiness reads badly, so the canvas draws a bounded
// sheet that tracks whatever has been painted and grows with it, with the
// pasteboard behind. Nothing in the model knows or cares.
//
// That distinction is why this lives in `canvas/` rather than `core/`: the
// content extent is a genuine derivation of the data (`contentBounds`, in
// core), but the padding, the minimum size and the centring are
// look-and-feel decisions with no business being baked into the data model.

import type { CellBounds } from '@/core/derive/bounds'

// How much empty grid to leave around the drawn content, so there is always
// somewhere to paint next without the sheet ending at your cursor.
export const PAGE_PADDING = 2

// The smallest sheet, for a blank map: otherwise a new project opens with
// nothing to aim at.
export const MIN_PAGE_COLS = 20
export const MIN_PAGE_ROWS = 15

// Grows the drawn extent into the sheet to render. `content` is null for an
// empty map.
export function pageBounds(content: CellBounds | null): CellBounds {
  if (!content) {
    return { minCol: 0, minRow: 0, maxCol: MIN_PAGE_COLS - 1, maxRow: MIN_PAGE_ROWS - 1 }
  }

  const padded: CellBounds = {
    minCol: content.minCol - PAGE_PADDING,
    minRow: content.minRow - PAGE_PADDING,
    maxCol: content.maxCol + PAGE_PADDING,
    maxRow: content.maxRow + PAGE_PADDING,
  }

  // Grow around the content's centre rather than from a corner, so a small map
  // sits centred on its sheet instead of hugging the top-left.
  const growCols = Math.max(0, MIN_PAGE_COLS - (padded.maxCol - padded.minCol + 1))
  const growRows = Math.max(0, MIN_PAGE_ROWS - (padded.maxRow - padded.minRow + 1))
  return {
    minCol: padded.minCol - Math.floor(growCols / 2),
    minRow: padded.minRow - Math.floor(growRows / 2),
    maxCol: padded.maxCol + Math.ceil(growCols / 2),
    maxRow: padded.maxRow + Math.ceil(growRows / 2),
  }
}
