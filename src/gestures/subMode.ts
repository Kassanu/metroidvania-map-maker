// The Draw/Edit sub-mode: which rows of the precedence table a press can reach.
//
//   - Cells only: edge-runs and vertices cannot be reached.
//   - Resize only: only edge-runs can be reached.
//   - Vertex only: only inner-wall vertices and segments can be reached.
//   - Auto: all rows can be reached.
//
// Pressing any room cell makes it active; this is handled separately.

export type SubMode = 'auto' | 'cells' | 'resize' | 'vertex'

// Order as they appear in the toolbar.
export const SUB_MODES: readonly SubMode[] = ['auto', 'cells', 'resize', 'vertex']

// Which rows of the precedence table a press may reach.
//
// `innerWall` covers both the "interior vertex" and the "on an inner-wall
// segment" rows, because they are one gesture. Drawing over a segment is
// drawing, with the segment already in the union.
export interface LiveRows {
  // Paint, grow, merge and erase: every row that changes cells.
  cells: boolean
  // The outer edge-run row.
  resize: boolean
  // The interior-vertex and inner-wall-segment rows, for drawing and erasing.
  innerWall: boolean
}

export function liveRows(subMode: SubMode): LiveRows {
  switch (subMode) {
    case 'auto':
      return { cells: true, resize: true, innerWall: true }
    case 'cells':
      return { cells: true, resize: false, innerWall: false }
    case 'resize':
      return { cells: false, resize: true, innerWall: false }
    case 'vertex':
      return { cells: false, resize: false, innerWall: true }
  }
}

// Handles shown for each mode are derived from the same record as which rows
// are live, so a handle is never drawn for a target a press cannot reach.
export function visibleHandles(subMode: SubMode): { runs: boolean; vertices: boolean } {
  const rows = liveRows(subMode)
  return { runs: rows.resize, vertices: rows.innerWall }
}
