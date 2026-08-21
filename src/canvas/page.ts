// The "page": the visual window drawn over the map's content.
//
// The grid itself is unbounded: this is presentation, not structure.
// Rendering infinite emptiness reads badly, so the canvas draws a bounded
// sheet with the pasteboard behind it. Nothing in the model knows or cares.
//
// The page is a union, never a resize to a minimum size. Each side is the
// further out of the padded content and `PAGE_HOME`, so the page is monotone
// in the content: it grows outward, never translates, and comes back to
// exactly `PAGE_HOME` once the content is gone. A minimum size would have to
// be reached by expanding around some centre, and every centre derived from
// the content moves when the content does, which slides the page sideways
// under a stationary camera.
//
// That distinction is why this lives in `canvas/` rather than `core/`: the
// content extent is a genuine derivation of the data (`contentBounds`, in
// core), but the padding, the home rectangle and the union are look-and-feel
// decisions with no business being baked into the data model.

import { unionBounds } from '@/core/derive/bounds'
import type { CellBounds } from '@/core/derive/bounds'

// How much empty grid to leave around the drawn content, so there is always
// somewhere to paint next without the sheet ending at your cursor. It is also
// what keeps the page ahead of a live stroke, since the content a gesture is
// mid-way through painting is padded like any other.
export const PAGE_PADDING = 2

// Where the page sits when there is nothing to frame, and the rectangle every
// page contains. Centred on the world origin, and 21x21 rather than 20x20 so
// that cell (0,0) is the middle cell rather than the cell down-right of a
// middle vertex.
export const PAGE_HOME: CellBounds = { minCol: -10, minRow: -10, maxCol: 10, maxRow: 10 }

// The sheet to render for a map's drawn extent. `content` is null for an
// empty map.
export function pageBounds(content: CellBounds | null): CellBounds {
  // Copied rather than returned directly: a caller holding the page must not
  // be able to write through to the constant every other page contains.
  if (!content) return { ...PAGE_HOME }

  return unionBounds(
    {
      minCol: content.minCol - PAGE_PADDING,
      minRow: content.minRow - PAGE_PADDING,
      maxCol: content.maxCol + PAGE_PADDING,
      maxRow: content.maxRow + PAGE_PADDING,
    },
    PAGE_HOME,
  )
}
