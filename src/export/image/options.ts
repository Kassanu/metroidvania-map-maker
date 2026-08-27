// What the export dialog lets somebody choose, and the ranges those choices
// live in.
//
// Here rather than in `config/constants.ts` because these are facts about image
// export and nothing else reads them: the dialog offers them, the preference
// store validates against them, and the scene builder clamps to them.

// The size control, in pixels per cell. A grid map has one natural unit of
// size and it is the cell, so this is the whole of the size control: 32 px per
// cell reads the same on a ten-cell map and a five-hundred-cell one, where a
// target width would need re-deriving per map.
//
// The list starts at 24 because `MIN_WALL_PX` is 1: below that both the outer
// and the inner wall clamp to a single pixel and a room's boundary stops being
// distinguishable from a wall drawn inside it. Every entry is a whole multiple
// of eight, which makes the liquid dither's checker square exact at every one
// of them.
export const PX_PER_CELL_PRESETS = [24, 32, 48, 64, 96, 128] as const
export const DEFAULT_PX_PER_CELL = 32

// The margin around the content, in whole cells.
//
// Cells rather than pixels: with the grid drawn, a pixel margin leaves a
// partial grid square around the edge of the image, and it is a fat frame at 24
// px per cell and a hairline at 128 where a cell margin holds its proportion.
//
// The minimum is 1 and not 0 because an outer wall is stroked centred on the
// rectangle's edge, so at 0 half of every boundary wall falls off the bitmap.
export const MARGIN_MIN = 1
export const MARGIN_MAX = 20
export const DEFAULT_MARGIN = 2
