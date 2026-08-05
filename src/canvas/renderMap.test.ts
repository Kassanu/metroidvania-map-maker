import { describe, it, expect, vi } from 'vitest'
import { renderMap, type HoveredHandle, type MapScene } from './renderMap'
import { DOOR_JAMB } from './doorRuns'
import { pageBounds } from './page'
import { interiorVertices, outerWalls, resizableRuns } from '@/core/derive/walls'
import type { CanvasPalette } from './palette'
import { createProject } from '@/core/factory'
import { paintCells, drawInnerWall } from '@/core/ops/rooms'
import { createFromBox, createTeleport, setDirection, setLock } from '@/core/ops/doors'
import { addMap } from '@/core/ops/maps'
import { teleportScene } from './teleports'
import { createNewArea } from '@/core/ops/project'
import { Transaction } from '@/core/journal'
import { edgeKey } from '@/core/cell'
import { ok, TEST_ICON_COLORS } from '@/core/testUtils'
import { createLine, placeIcon, setIconLabel, setLineStyle } from '@/core/ops/markup'
import { iconArtCatalogue, getIcon } from '@/icons/registry'
import { ICON_VIEWBOX, UNKNOWN_ICON_ART } from './iconBadge'
import { OPEN_LOCK_ID, WORLD_AREA_ID } from '@/core/ids'
import type { IconId, LineId, LockTypeId, MapId, RoomId, TransitionId } from '@/core/ids'
import type { CellKey } from '@/core/cell'
import type { MapModel, ProjectModel } from '@/core/types'

// The one shipped editable lock type, and the only coloured thing a fresh
// project has: a lock picker, and these tests, have real content on day one
// without any management UI.
const LOCKED_LOCK_ID = 'locked' as LockTypeId

// Both handle families on, which is Auto: the sub-mode lock's own filtering
// is tested where the lock lives, so every scene here says "nothing hidden".
const ALL_HANDLES = { runs: true, vertices: true }

// Deliberately not a common default like 32, so a test would fail if
// renderMap ignored scene.tileSize and used a hardcoded value of its own.
const TILE = 20

// A recording stub rather than a real context: pulling these functions out of
// the component means they need no canvas, no jsdom and no layout to verify.
function fakeContext() {
  const fills: { style: string; rect: number[] }[] = []
  // Each stroke() call, with the segments queued since the last beginPath()
  // and the state they were drawn under: enough to check how a wall was
  // drawn, not merely that something was stroked.
  const strokes: {
    style: string
    width: number
    dash: number[]
    join: string
    segments: number[][]
  }[] = []
  let pending: number[][] = []
  let cursor: number[] = [0, 0]
  let dash: number[] = []
  const labels: { text: string; style: string; at: number[] }[] = []
  // The chip behind a label, recorded where it is drawn: the fill style is set
  // immediately before the path is built, so it is the plate's colour.
  const chips: { style: string; rect: number[] }[] = []
  // Each fill(path) call with the path data and the transform it was drawn
  // under, so a badge's colour, art and placed rect are all assertable. Only
  // translate and uniform scale are tracked, which is all the badges use.
  const badges: { style: string; data: string; x: number; y: number; scale: number }[] = []
  let transform = { x: 0, y: 0, scale: 1 }
  const saved: (typeof transform)[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: vi.fn((text: string, x: number, y: number) =>
      labels.push({ text, style: ctx.fillStyle, at: [x, y] }),
    ),
    clearRect: vi.fn(),
    fillRect: vi.fn((...rect: number[]) => fills.push({ style: ctx.fillStyle, rect })),
    beginPath: vi.fn(() => {
      pending = []
    }),
    moveTo: vi.fn((x: number, y: number) => {
      cursor = [x, y]
    }),
    lineTo: vi.fn((x: number, y: number) => {
      pending.push([...cursor, x, y])
      cursor = [x, y]
    }),
    lineJoin: '',
    lineCap: '',
    stroke: vi.fn(() => {
      strokes.push({
        style: ctx.strokeStyle,
        width: ctx.lineWidth,
        dash,
        join: ctx.lineJoin,
        segments: pending,
      })
      pending = []
    }),
    setLineDash: vi.fn((segments: number[]) => {
      dash = segments
    }),
    save: vi.fn(() => {
      saved.push({ ...transform })
    }),
    restore: vi.fn(() => {
      transform = saved.pop() ?? transform
    }),
    translate: vi.fn((x: number, y: number) => {
      transform.x += x * transform.scale
      transform.y += y * transform.scale
    }),
    scale: vi.fn((k: number) => {
      transform.scale *= k
    }),
    // Two callers, told apart by the argument: a badge fills a Path2D, and a
    // label chip fills the current path built by `roundRect` above.
    fill: vi.fn((path?: { data: string }) => {
      if (path) badges.push({ style: ctx.fillStyle, data: path.data, ...transform })
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    roundRect: vi.fn((x: number, y: number, width: number, height: number) =>
      chips.push({ style: ctx.fillStyle, rect: [x, y, width, height] }),
    ),
  }
  return { ctx, fills, strokes, labels, chips, badges }
}

// A project with one map, built through the real ops so the model under test
// is the one the app would hand the renderer.
function withMap(build: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
  const project = createProject({
    projectName: 'Fixture',
    firstMapName: 'Map 1',
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!
  const tx = new Transaction('build', { kind: 'map', mapId: map.id })
  build(tx, project, map)
  tx.commit()
  return { project, map }
}

const palette: CanvasPalette = {
  pasteboard: '#pasteboard',
  page: '#page',
  grid: '#grid',
  ruler: '#ruler',
  rulerTick: '#tick',
  rulerText: '#text',
  roomFill: '#roomfill',
  roomWall: '#roomwall',
  transition: '#transition',
  teleportLine: '#teleportline',
  markerText: '#markertext',
  labelPlate: '#labelplate',
  labelText: '#labeltext',
  absorb: '#absorb',
  refuse: '#refuse',
  brush: '#brush',
  handle: '#handle',
  handleHover: '#handlehover',
  selection: '#selection',
  selectionFill: '#selectionfill',
  marquee: '#marquee',
  marqueeFill: '#marqueefill',
}

function scene(overrides: Partial<MapScene> = {}): MapScene {
  return {
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    bounds: pageBounds(null),
    tileSize: TILE,
    map: null,
    // Both layer toggles default on, so a scene that does not override them
    // is fully visible; the toggles' own tests are what turn them off.
    showTransitions: true,
    showTeleportLines: true,
    showIcons: true,
    showLines: true,
    // Hover-only by default, matching the pref: a scene that says nothing about
    // labels draws none, so every label assertion has to ask for one.
    showAllLabels: false,
    hoveredLabel: null,
    selectedMarkup: new Set(),
    areas: new Map(),
    lockTypes: new Map(),
    iconArt: iconArtCatalogue(),
    teleports: { ends: [], lines: [] },
    ghost: null,
    brushPreview: null,
    boxPreview: null,
    pendingTeleport: null,
    selected: new Set(),
    selectedRooms: new Set(),
    selectedCells: new Set(),
    handleRoom: null,
    marquee: null,
    palette,
    showGrid: true,
    ...overrides,
  }
}

describe('renderMap', () => {
  it('clears, then lays the pasteboard down before the page', () => {
    const { ctx, fills } = fakeContext()
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene())

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600)
    expect(fills[0]).toEqual({ style: '#pasteboard', rect: [0, 0, 800, 600] })
    expect(fills[1].style).toBe('#page')
  })

  it('sizes the page from the map bounds, inclusive of the last cell', () => {
    const { ctx, fills } = fakeContext()
    const bounds = { minCol: 0, minRow: 0, maxCol: 3, maxRow: 1 }
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene({ bounds }))

    // 4 columns x 2 rows at the project's tile size, zoom 1.
    const [x, y, width, height] = fills[1].rect
    expect([x, y]).toEqual([0, 0])
    expect(width).toBeCloseTo(4 * TILE)
    expect(height).toBeCloseTo(2 * TILE)
  })

  it('draws a grid line per cell boundary, one path, one stroke', () => {
    const { ctx } = fakeContext()
    const bounds = { minCol: 0, minRow: 0, maxCol: 3, maxRow: 1 }
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene({ bounds }))

    // 5 verticals (4 columns + 1) and 3 horizontals (2 rows + 1).
    expect(ctx.moveTo).toHaveBeenCalledTimes(8)
    expect(ctx.beginPath).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

  // The page is as large as the map's content and the content is unbounded, so
  // a line per column of the page is a per-frame cost with no ceiling. Only
  // the lines that cross the canvas are drawn.
  it('draws only the grid lines the canvas can show', () => {
    const { ctx } = fakeContext()
    const bounds = { minCol: 0, minRow: 0, maxCol: 500_000, maxRow: 500_000 }
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene({ bounds }))

    // 800px and 600px of canvas at 20px a cell: 41 verticals and 31
    // horizontals, not half a million of each.
    expect(ctx.moveTo).toHaveBeenCalledTimes(41 + 31)
  })

  it('still stops the grid at the page edge when the page is smaller than the canvas', () => {
    const { ctx } = fakeContext()
    const bounds = { minCol: 0, minRow: 0, maxCol: 3, maxRow: 1 }
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene({ bounds }))

    expect(ctx.moveTo).toHaveBeenCalledTimes(8)
  })

  it('skips the grid entirely when it is switched off, but still paints the page', () => {
    const { ctx, fills } = fakeContext()
    renderMap(ctx as unknown as CanvasRenderingContext2D, 800, 600, scene({ showGrid: false }))

    expect(fills.map((f) => f.style)).toEqual(['#pasteboard', '#page'])
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('moves the page with the camera', () => {
    const { ctx, fills } = fakeContext()
    renderMap(
      ctx as unknown as CanvasRenderingContext2D,
      800,
      600,
      scene({ camera: { pan: { x: -2, y: -1 }, zoom: 1 } }),
    )

    // Panning to negative world coords pushes the page down and right.
    expect(fills[1].rect[0]).toBeCloseTo(2 * TILE)
    expect(fills[1].rect[1]).toBeCloseTo(1 * TILE)
  })

  it('scales the page with the zoom', () => {
    const { ctx, fills } = fakeContext()
    const bounds = { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 }
    renderMap(
      ctx as unknown as CanvasRenderingContext2D,
      800,
      600,
      scene({ bounds, camera: { pan: { x: 0, y: 0 }, zoom: 2 } }),
    )

    expect(fills[1].rect[2]).toBeCloseTo(TILE * 2) // one cell at 2x
  })
})

describe('renderMap drawing rooms', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  it('fills each of a room’s cells at the page scale', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID }),
    )

    draw(ctx, { map, areas: project.areas })

    // Pasteboard, page, then one rect per room cell.
    const cellFills = fills.slice(2)
    expect(cellFills).toHaveLength(2)
    expect(cellFills[0].rect[2]).toBeCloseTo(TILE)
    expect(cellFills[0].rect[3]).toBeCloseTo(TILE)
  })

  // Colour lives on the area, never on the room, so this is the whole colour
  // model in one assertion.
  it('takes its colours from the room’s area', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      const area = createNewArea(tx, project, 'Crateria', '#123456', '#abcdef')
      paintCells(tx, project, map, ['0,0'], { areaId: area.id })
    })

    draw(ctx, { map, areas: project.areas })

    expect(fills[2].style).toBe('#123456')
    expect(strokes.some((stroke) => stroke.style === '#abcdef')).toBe(true)
  })

  // Null is not a missing value: it means "resolve from the active theme",
  // which is how the immutable World area stays neutral in light and dark.
  it('falls back to the theme neutral for an area with null colours', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )

    draw(ctx, { map, areas: project.areas })

    expect(fills[2].style).toBe('#roomfill')
    expect(strokes.some((stroke) => stroke.style === '#roomwall')).toBe(true)
  })

  // The grid is the paper the rooms sit on: room drawing must not depend on
  // whether it is shown.
  it('draws rooms whether the grid is on or off', () => {
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )

    const on = fakeContext()
    draw(on.ctx, { map, areas: project.areas, showGrid: true })
    const off = fakeContext()
    draw(off.ctx, { map, areas: project.areas, showGrid: false })

    expect(on.fills).toHaveLength(3)
    expect(off.fills).toHaveLength(3)
    expect(off.fills[2].style).toBe('#roomfill')
  })

  it('lays the grid down before the rooms, not over them', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )

    draw(ctx, { map, areas: project.areas })

    // The grid stroke is recorded before the room fill is.
    expect(strokes[0].style).toBe('#grid')
    expect(fills[2].style).toBe('#roomfill')
    expect(ctx.fillRect.mock.invocationCallOrder[2]).toBeGreaterThan(
      ctx.stroke.mock.invocationCallOrder[0],
    )
  })

  // A boundary edge has a wall; a shared internal edge does not. A 2x1 room
  // has six outer edges, not eight: the shared edge between its cells is
  // never stored as a wall either way.
  it('derives outer walls from cell adjacency, skipping shared edges', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID }),
    )

    draw(ctx, { map, areas: project.areas })

    const outer = strokes.find((s) => s.style === '#roomwall')!
    expect(outer.segments).toHaveLength(6)
  })

  it('draws a dotted inner wall dashed, and a doorway as two stubs with a gap', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      const room = paintCells(tx, project, map, ['0,0', '1,0', '0,1', '1,1'], {
        areaId: WORLD_AREA_ID,
      })
      drawInnerWall(tx, map, room.id, edgeKey(1, 0, 'V'), 'dotted')
      drawInnerWall(tx, map, room.id, edgeKey(1, 1, 'V'), 'doorway')
    })

    draw(ctx, { map, areas: project.areas })

    const dotted = strokes.find((s) => s.dash.length > 0)!
    expect(dotted.segments).toHaveLength(1)

    // Two stubs rather than one line, and together they are shorter than the
    // full edge: that gap is what makes it read as a doorway.
    const doorway = strokes.filter((s) => s.dash.length === 0 && s.segments.length === 2).at(-1)!
    const drawn = doorway.segments.reduce((total, [, y0, , y1]) => total + Math.abs(y1 - y0), 0)
    expect(drawn).toBeCloseTo(TILE * (2 / 3))
  })

  it('renders an empty map as a bare page', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = withMap(() => {})

    draw(ctx, { map, areas: project.areas })

    expect(fills).toHaveLength(2)
  })
})

// A transition on a shared wall breaks the wall at its location (a doorway
// gap) rather than sitting as a box over an unbroken wall, and the lock-type
// colour renders as the door's marker over that gap. Colourless is the common
// case, not an edge case: `Open` is permanently colourless, so a default door
// is exactly a hole in the wall.
describe('renderMap drawing edge doors', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // Two 1x2 rooms either side of the seam at x = 1, so the seam is exactly two
  // edges long and every assertion below can be arithmetic on TILE.
  function acrossASeam(build?: (tx: Transaction, project: ProjectModel, map: MapModel) => void) {
    return withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      build?.(tx, project, map)
    })
  }

  const SEAM_X = TILE // the seam at world x = 1, at zoom 1 with no pan

  // How much wall is drawn on the seam, over both rooms: each draws its own
  // side in its own colour, so the door has to be missing from both. Only
  // `#roomwall`-styled strokes are summed, so a marker mistakenly drawn in
  // the wall colour would inflate this instead of going unnoticed.
  function seamLength(strokes: { style: string; segments: number[][] }[]): number {
    let total = 0
    for (const stroke of strokes) {
      if (stroke.style !== '#roomwall') continue
      for (const [x0, y0, x1, y1] of stroke.segments) {
        if (x0 === SEAM_X && x1 === SEAM_X) total += Math.abs(y1 - y0)
      }
    }
    return total
  }

  // The two bounds are the point, and the arithmetic is the detail. An expected
  // length derived from `DOOR_JAMB` says nothing on its own: set the constant to
  // zero and both sides of the comparison go to zero together, so the assertion
  // holds while the jambs it is checking for have disappeared. `> 0` is what
  // fails then, and `< whole` is what fails if the wall stops breaking at all.
  function expectSeam(strokes: { style: string; segments: number[][] }[], expected: number) {
    const drawn = seamLength(strokes)
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThan(4 * TILE)
    expect(drawn).toBeCloseTo(expected)
  }

  function markerSegments(strokes: { style: string; segments: number[][] }[]) {
    return strokes.filter((stroke) => stroke.style === '#e23b3b').flatMap((s) => s.segments)
  }

  it('leaves the seam whole when there is no door on it', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam()

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // Two rooms, two edges each, drawn full length.
    expect(seamLength(strokes)).toBeCloseTo(4 * TILE)
  })

  // A door is a hole, not a decal, and the jambs are why it is a hole rather
  // than a missing wall: this fixture's 2-segment door spans the entire
  // boundary the two rooms share, so without the jambs the seam would vanish
  // and the pair would read as one room.
  it('breaks the wall along the door, leaving a jamb at each end of the run', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      ok(createFromBox(tx, project, map, '0,0', '1,1'))
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // One jamb at each end of the run, per room: 2 rooms x 2 jambs.
    expectSeam(strokes, 4 * DOOR_JAMB * TILE)
  })

  // `Open` is permanently colourless, so this is what the default door looks
  // like: the gap, and nothing in it.
  it('draws no marker for a colourless lock, but still breaks the wall', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      ok(createFromBox(tx, project, map, '0,0', '1,0'))
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // Every stroke is one of the palette's own colours: nothing was painted
    // in a lock colour, because this lock has none.
    const palettes = new Set(Object.values(palette))
    expect(strokes.every((stroke) => palettes.has(stroke.style))).toBe(true)
    // This door covers one of the seam's two edges, so what is left is the
    // undoored edge in full plus a jamb at each end of the doored one, per room.
    expectSeam(strokes, 2 * TILE + 4 * DOOR_JAMB * TILE)
  })

  it('marks the gap in the lock colour, over the walls', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
      setLock(tx, project, map, door.id, 'both', LOCKED_LOCK_ID)
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    const segments = markerSegments(strokes)
    expect(segments).toHaveLength(1)
    const [x0, y0, x1, y1] = segments[0]
    expect([x0, x1]).toEqual([SEAM_X, SEAM_X])
    // Exactly the gap the walls left: one cell less a jamb at each end.
    expect(y0).toBeCloseTo(DOOR_JAMB * TILE)
    expect(y1).toBeCloseTo((1 - DOOR_JAMB) * TILE)

    // Over the wall, not under it: a marker drawn first would be overpainted
    // by the very wall it is meant to interrupt.
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    const marker = strokes.findIndex((stroke) => stroke.style === '#e23b3b')
    expect(marker).toBeGreaterThan(wall)
  })

  // An N-wide door is one door. Drawing it per segment would put a marker end
  // inside the opening at every cell boundary, which reads as N doors in a row.
  it('draws an N-wide door as a single marker spanning the whole run', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,1'))
      setLock(tx, project, map, door.id, 'both', LOCKED_LOCK_ID)
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    const segments = markerSegments(strokes)
    expect(segments).toHaveLength(1)
    const [, y0, , y1] = segments[0]
    expect(y1 - y0).toBeCloseTo((2 - 2 * DOOR_JAMB) * TILE)
  })

  // An edge door is one marker on one seam, so per-end locks cannot both show
  // until a split marker exists. Until then it renders the synced look, and
  // the coloured end is the one worth seeing.
  it('falls back to whichever end has a colour while the split marker is deferred', () => {
    for (const end of ['a', 'b'] as const) {
      const { ctx, strokes } = fakeContext()
      const { project, map } = acrossASeam((tx, project, map) => {
        const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
        setLock(tx, project, map, door.id, end, LOCKED_LOCK_ID)
      })

      draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

      expect(markerSegments(strokes)).toHaveLength(1)
    }
  })

  // A door's one-way arrow points through the edge, across the seam rather
  // than along it, from room A's side to room B's. Which room is A is decided
  // by where the drag started, so the same two rooms give opposite arrows.
  it('points a one-way door’s arrow across the seam, away from the room it was drawn from', () => {
    const apexOf = (from: string, to: string) => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = acrossASeam((tx, project, map) => {
        const [door] = ok(createFromBox(tx, project, map, from, to))
        setDirection(tx, project, map, door.id, 'aToB')
      })
      draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

      const arrow = strokes.find(
        (stroke) => stroke.style === '#transition' && stroke.segments.length === 2,
      )!
      // The chevron's two segments meet at the apex, which is the point the
      // arrow indicates.
      expect(arrow.segments[0][2]).toBe(arrow.segments[1][0])
      return arrow.segments[0][2]
    }

    // Drawn from the west room: A is west, so the arrow points east, past the
    // seam. Drawn from the east room: A is east and it points back.
    expect(apexOf('0,0', '1,0')).toBeGreaterThan(SEAM_X)
    expect(apexOf('1,0', '0,0')).toBeLessThan(SEAM_X)
  })

  // B -> A is the same crossing travelled the other way, and the only thing
  // that distinguishes it: the endpoints, the per-end locks and the geometry
  // are all untouched, so an arrow that ignored the reversal would render a
  // door identical to its opposite.
  it('reverses a one-way door’s arrow for B -> A', () => {
    const apexOf = (direction: 'aToB' | 'bToA') => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = acrossASeam((tx, project, map) => {
        const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
        setDirection(tx, project, map, door.id, direction)
      })
      draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

      const arrow = strokes.find(
        (stroke) => stroke.style === '#transition' && stroke.segments.length === 2,
      )!
      return arrow.segments[0][2]
    }

    expect(apexOf('aToB')).toBeGreaterThan(SEAM_X)
    expect(apexOf('bToA')).toBeLessThan(SEAM_X)
  })

  it('draws no arrow for a two-way door, whatever its colour', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
      setLock(tx, project, map, door.id, 'both', LOCKED_LOCK_ID)
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    expect(
      strokes.some((stroke) => stroke.style === '#transition' && stroke.segments.length === 2),
    ).toBe(false)
  })

  // The arrow is the only thing a colourless one-way door has to say which way
  // it goes, so unlike the marker it cannot be skipped when there is no colour.
  it('draws the arrow on a colourless one-way door', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossASeam((tx, project, map) => {
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
      setDirection(tx, project, map, door.id, 'aToB')
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // No lock colour anywhere: just the gap and the arrow.
    expect(strokes.some((stroke) => stroke.style === '#e23b3b')).toBe(false)
    expect(
      strokes.filter((stroke) => stroke.style === '#transition' && stroke.segments.length === 2),
    ).toHaveLength(1)
  })

  // Elevator endpoints are anchored to cell edges too (`transitionsAtEdge`
  // holds both kinds), but an elevator spans a gap rather than sitting on a
  // shared wall, so it must not break one.
  it('leaves walls alone for an elevator', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['3,0'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, '0,0', '3,0'))
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // Two 1x1 rooms, four full edges each, none of them interrupted.
    const walls = strokes.filter((stroke) => stroke.style === '#roomwall')
    expect(walls.flatMap((stroke) => stroke.segments)).toHaveLength(8)
  })
})

// The shaft renders behind room cells and only draws in empty cells, and its
// two ends show the lock facing each room.
describe('renderMap drawing elevators', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // Two 1x1 rooms on row 0 with a three-cell gap, and an elevator across it.
  function acrossAGap(
    build?: (tx: Transaction, project: ProjectModel, map: MapModel) => void,
    from: string = '0,0',
    to: string = '4,0',
  ) {
    return withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['4,0'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, from, to))
      build?.(tx, project, map)
    })
  }

  const shaftRects = (fills: { style: string; rect: number[] }[]) =>
    fills.filter((fill) => fill.style === '#transition')

  it('draws one band per gap cell, narrower than the cell across its axis', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = acrossAGap()

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    const shaft = shaftRects(fills)
    expect(shaft).toHaveLength(3)
    // Full cell along the run, inset across it: the gap either side is what
    // makes it read as passing through rather than as a row of rooms.
    const [x, y, width, height] = shaft[0].rect
    expect(width).toBeCloseTo(TILE)
    expect(height).toBeLessThan(TILE)
    expect(x).toBeCloseTo(TILE)
    expect(y).toBeCloseTo((TILE - height) / 2)
  })

  // Under the rooms, and over the page. The pasteboard and page fills come
  // first, so a shaft drawn before those would be painted over entirely.
  it('lays the shaft under the room fills and over the page', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = acrossAGap()

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    expect(fills.map((fill) => fill.style).slice(0, 3)).toEqual([
      '#pasteboard',
      '#page',
      '#transition',
    ])
    expect(fills.at(-1)!.style).toBe('#roomfill')
  })

  it('leaves out a cell a third room occupies', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = acrossAGap((tx, project, map) => {
      paintCells(tx, project, map, ['2,0'], { areaId: WORLD_AREA_ID })
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // Two bands with the room showing between them, not three.
    expect(shaftRects(fills)).toHaveLength(2)
  })

  it('marks each end on its facing edge, in that end’s lock colour', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossAGap((tx, project, map) => {
      const [elevator] = [...map.transitions.values()]
      setLock(tx, project, map, elevator.id, 'a', LOCKED_LOCK_ID)
    })

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    // A is the drag's origin room, at x=0, so its end sits on that room's
    // east wall (the edge at world x=1) and carries the red lock.
    const a = strokes.find((stroke) => stroke.style === '#e23b3b')!
    expect(a.segments).toHaveLength(1)
    const [x0, y0, x1, y1] = a.segments[0]
    expect([x0, x1]).toEqual([TILE, TILE])
    expect(y1 - y0).toBeLessThan(TILE)

    // B's lock is colourless, so its end falls back to the neutral transition
    // colour rather than not being drawn: an elevator has no wall to break,
    // so a missing marker would just be a missing end.
    const b = strokes.filter(
      (stroke) => stroke.style === '#transition' && stroke.segments.length === 1,
    )
    expect(b).toHaveLength(1)
    expect(b[0].segments[0][0]).toBeCloseTo(4 * TILE)
  })

  it('draws a one-way arrow along the shaft, and none for a two-way', () => {
    const oneWay = fakeContext()
    const fixture = acrossAGap((tx, project, map) => {
      const [elevator] = [...map.transitions.values()]
      setDirection(tx, project, map, elevator.id, 'aToB')
    })
    draw(oneWay.ctx, {
      map: fixture.map,
      areas: fixture.project.areas,
      lockTypes: fixture.project.lockTypes,
    })

    // A chevron: two segments meeting at the apex, downstream of the shaft's
    // midpoint. Drawn in the label colour rather than the transition colour,
    // because it sits on the shaft: the transition colour would be invisible
    // there, so checking the colour is what stops a broken render passing.
    const arrow = oneWay.strokes.find(
      (stroke) => stroke.style === '#markertext' && stroke.segments.length === 2,
    )!
    expect(arrow.segments[0][2]).toBe(arrow.segments[1][0])
    expect(arrow.segments[0][2]).toBeGreaterThan(2.5 * TILE)

    const twoWay = fakeContext()
    const plain = acrossAGap()
    draw(twoWay.ctx, {
      map: plain.map,
      areas: plain.project.areas,
      lockTypes: plain.project.lockTypes,
    })
    expect(
      twoWay.strokes.some(
        (stroke) => stroke.style === '#markertext' && stroke.segments.length === 2,
      ),
    ).toBe(false)
  })

  // The arrow points the way the elevator does, so a drag made right-to-left
  // must not draw one pointing right. The gap cells carry that direction, which
  // is why they are in walk order rather than sorted.
  it('points the arrow the way the elevator runs, not the way the axis does', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = acrossAGap(
      (tx, project, map) => {
        const [elevator] = [...map.transitions.values()]
        setDirection(tx, project, map, elevator.id, 'aToB')
      },
      '4,0',
      '0,0',
    )

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    const arrow = strokes.find(
      (stroke) => stroke.style === '#markertext' && stroke.segments.length === 2,
    )!
    // Apex left of the midpoint: the shaft runs from x=4 back toward x=0.
    expect(arrow.segments[0][2]).toBeLessThan(2.5 * TILE)
  })

  it('reverses the shaft arrow for B -> A', () => {
    const apexOf = (direction: 'aToB' | 'bToA') => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = acrossAGap((tx, project, map) => {
        const [elevator] = [...map.transitions.values()]
        setDirection(tx, project, map, elevator.id, direction)
      })
      draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

      const arrow = strokes.find(
        (stroke) => stroke.style === '#markertext' && stroke.segments.length === 2,
      )!
      return arrow.segments[0][2]
    }

    expect(apexOf('aToB')).toBeGreaterThan(2.5 * TILE)
    expect(apexOf('bToA')).toBeLessThan(2.5 * TILE)
  })

  // A live, valid elevator with nothing to draw: the arrow has no cell to
  // sit in, so an implementation that reaches for the middle of an empty
  // list throws before any of the assertions below run.
  it('draws nothing at all when rooms have filled the whole gap', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = acrossAGap((tx, project, map) => {
      const [elevator] = [...map.transitions.values()]
      setDirection(tx, project, map, elevator.id, 'aToB')
      for (const cell of ['1,0', '2,0', '3,0']) {
        paintCells(tx, project, map, [cell], { areaId: WORLD_AREA_ID })
      }
    })

    expect(map.transitions.size).toBe(1)
    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    expect(shaftRects(fills)).toHaveLength(0)
    expect(
      strokes.some((stroke) => stroke.style === '#markertext' && stroke.segments.length === 2),
    ).toBe(false)
  })
})

// A teleport draws as endpoint markers plus a faint connecting line. A
// cross-tab one's far end shows a marker cell with the destination tab's
// first letter.
describe('renderMap drawing teleports', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // Surface with two rooms, Caves with one: the same fixture serves the
  // same-map case and the cross-tab case.
  function twoMaps(build: (tx: Transaction, project: ProjectModel, ids: [MapId, MapId]) => void) {
    const project = createProject({
      projectName: 'Fixture',
      firstMapName: 'Surface',
      worldAreaName: 'World',
      openLockName: 'Open',
      lockedLockName: 'Locked',
    })
    const surfaceId = project.maps[0]
    const tx = new Transaction('build', { kind: 'project' })
    const caves = addMap(tx, project, 'Caves')
    const surface = project.mapsById.get(surfaceId)!
    paintCells(tx, project, surface, ['0,0'], { areaId: WORLD_AREA_ID })
    paintCells(tx, project, surface, ['5,5'], { areaId: WORLD_AREA_ID })
    paintCells(tx, project, caves, ['2,2'], { areaId: WORLD_AREA_ID })
    build(tx, project, [surfaceId, caves.id])
    tx.commit()
    return { project, surfaceId, cavesId: caves.id }
  }

  function sameMap() {
    return twoMaps((tx, project, [surface]) => {
      ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
    })
  }

  function sceneFor(project: ProjectModel, mapId: MapId): Partial<MapScene> {
    return {
      map: project.mapsById.get(mapId)!,
      areas: project.areas,
      lockTypes: project.lockTypes,
      teleports: teleportScene(project, mapId),
    }
  }

  it('marks both ends inside their cells and links them with a faint line', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, surfaceId } = sameMap()

    draw(ctx, sceneFor(project, surfaceId))

    const markers = fills.filter((fill) => fill.style === '#transition')
    expect(markers).toHaveLength(2)
    // Inside the cell, not filling it: a teleport is a point in the interior.
    const [x, y, width, height] = markers[0].rect
    expect(width).toBeLessThan(TILE)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    expect(height).toBeCloseTo(width)

    // Centre to centre, in the faint colour.
    const line = strokes.find((stroke) => stroke.style === '#teleportline')!
    expect(line.segments).toEqual([[0.5 * TILE, 0.5 * TILE, 5.5 * TILE, 5.5 * TILE]])
  })

  it('draws the line before the markers, so an endpoint is never half covered', () => {
    const { ctx } = fakeContext()
    const { project, surfaceId } = sameMap()

    draw(ctx, sceneFor(project, surfaceId))

    const lastStroke = ctx.stroke.mock.invocationCallOrder.at(-1)!
    const lastFill = ctx.fillRect.mock.invocationCallOrder.at(-1)!
    expect(lastFill).toBeGreaterThan(lastStroke)
  })

  it('takes each marker’s colour from the lock facing its own room', () => {
    const { ctx, fills } = fakeContext()
    const { project, surfaceId } = twoMaps((tx, project, [surface]) => {
      const teleport = ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
      // Only the A end, which is what a teleport can show and an edge door
      // cannot until the split marker lands.
      setLock(tx, project, project.mapsById.get(surface)!, teleport.id, 'a', LOCKED_LOCK_ID)
    })

    draw(ctx, sceneFor(project, surfaceId))

    expect(fills.filter((fill) => fill.style === '#e23b3b')).toHaveLength(1)
    expect(fills.filter((fill) => fill.style === '#transition')).toHaveLength(1)
  })

  it('labels a cross-tab marker with the destination tab’s letter, centred', () => {
    const { ctx, labels } = fakeContext()
    const { project, surfaceId, cavesId } = twoMaps((tx, project, [surface, caves]) => {
      ok(
        createTeleport(tx, project, { mapId: surface, cell: '0,0' }, { mapId: caves, cell: '2,2' }),
      )
    })

    draw(ctx, sceneFor(project, surfaceId))
    expect(labels).toEqual([{ text: 'C', style: '#markertext', at: [0.5 * TILE, 0.5 * TILE] }])

    // And the other tab, which stores no transition of its own: its marker is
    // rebuilt from the far-end index.
    const far = fakeContext()
    draw(far.ctx, sceneFor(project, cavesId))
    expect(far.labels).toEqual([{ text: 'S', style: '#markertext', at: [2.5 * TILE, 2.5 * TILE] }])
    expect(far.fills.filter((fill) => fill.style === '#transition')).toHaveLength(1)
  })

  it('draws no letter on a same-map teleport', () => {
    const { ctx, labels } = fakeContext()
    const { project, surfaceId } = sameMap()

    draw(ctx, sceneFor(project, surfaceId))
    expect(labels).toEqual([])
  })

  it('draws an arrow along a one-way line, pointing A to B', () => {
    const { ctx, strokes } = fakeContext()
    const { project, surfaceId } = twoMaps((tx, project, [surface]) => {
      const teleport = ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
      setDirection(tx, project, project.mapsById.get(surface)!, teleport.id, 'aToB')
    })

    draw(ctx, sceneFor(project, surfaceId))

    const arrow = strokes.find(
      (stroke) => stroke.style === '#transition' && stroke.segments.length === 2,
    )!
    // The apex is past the line's midpoint, in the direction of travel: down
    // and to the right, since B is at (5,5).
    const [, , apexX, apexY] = arrow.segments[0]
    expect(apexX).toBeGreaterThan(3 * TILE)
    expect(apexY).toBeGreaterThan(3 * TILE)
  })

  it('reverses the line arrow for B -> A', () => {
    const { ctx, strokes } = fakeContext()
    const { project, surfaceId } = twoMaps((tx, project, [surface]) => {
      const teleport = ok(
        createTeleport(
          tx,
          project,
          { mapId: surface, cell: '0,0' },
          { mapId: surface, cell: '5,5' },
        ),
      )
      setDirection(tx, project, project.mapsById.get(surface)!, teleport.id, 'bToA')
    })

    draw(ctx, sceneFor(project, surfaceId))

    const arrow = strokes.find(
      (stroke) => stroke.style === '#transition' && stroke.segments.length === 2,
    )!
    // Back up and to the left: the same line travelled from B to A.
    const [, , apexX, apexY] = arrow.segments[0]
    expect(apexX).toBeLessThan(3 * TILE)
    expect(apexY).toBeLessThan(3 * TILE)
  })
})

// The rubber-band box: the one ghost that is not model state. A valid box has
// its result on the canvas already (applied speculatively); an invalid one
// has nothing but this.
describe('renderMap drawing the box preview', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const boxStroke = (strokes: { style: string; segments: number[][] }[]) =>
    strokes.find((stroke) => stroke.style === '#brush' || stroke.style === '#refuse')!

  // A box drag only exists on a map, and `renderMap` draws nothing at all
  // without one, so every scene here has the two rooms a box would be drawn
  // between.
  function onAMap(boxPreview: MapScene['boxPreview']): Partial<MapScene> {
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
    })
    return { map, areas: project.areas, lockTypes: project.lockTypes, boxPreview }
  }

  it('outlines the box the two corners span', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, onAMap({ from: '1,1', to: '3,2', outcome: 'edge' }))

    const box = boxStroke(strokes)
    expect(box.style).toBe('#brush')
    // Four sides, traced corner to corner, from (1,1) to (4,3) in cells.
    expect(box.segments).toEqual([
      [TILE, TILE, 4 * TILE, TILE],
      [4 * TILE, TILE, 4 * TILE, 3 * TILE],
      [4 * TILE, 3 * TILE, TILE, 3 * TILE],
      [TILE, 3 * TILE, TILE, TILE],
    ])
  })

  // The corners are wherever the drag started and wherever it is now, in
  // either order: a box dragged up and left covers the same cells as one
  // dragged down and right, so the outline must not depend on the direction.
  it('draws the same rectangle whichever corner the drag started from', () => {
    const forward = fakeContext()
    const backward = fakeContext()

    draw(forward.ctx, onAMap({ from: '1,1', to: '3,2', outcome: 'edge' }))
    draw(backward.ctx, onAMap({ from: '3,2', to: '1,1', outcome: 'edge' }))

    expect(boxStroke(backward.strokes).segments).toEqual(boxStroke(forward.strokes).segments)
  })

  // An invalid box cancels and nothing is applied, so this outline is the
  // whole feedback: it has to look like a refusal rather than like an aid
  // that has not landed yet.
  it('marks an invalid box in the refusal colour, dashed', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, onAMap({ from: '1,1', to: '3,2', outcome: 'invalid' }))

    const box = boxStroke(strokes)
    expect(box.style).toBe('#refuse')
    expect((box as unknown as { dash: number[] }).dash.length).toBeGreaterThan(0)
  })

  it('leaves the dash off a valid one, and draws nothing without a box', () => {
    const valid = fakeContext()
    draw(valid.ctx, onAMap({ from: '1,1', to: '3,2', outcome: 'elevator' }))
    expect((boxStroke(valid.strokes) as unknown as { dash: number[] }).dash).toEqual([])

    const none = fakeContext()
    draw(none.ctx, onAMap(null))
    expect(none.strokes.some((stroke) => stroke.style === '#brush')).toBe(false)
    expect(none.strokes.some((stroke) => stroke.style === '#refuse')).toBe(false)
  })

  // Over the transition it is about to create: the box is the gesture, and the
  // gesture stays legible on top of its own result.
  it('draws the box last, over everything else', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, onAMap({ from: '0,0', to: '1,0', outcome: 'edge' }))

    expect(strokes.at(-1)!.style).toBe('#brush')
  })
})

// The pending teleport's origin: the second thing on this canvas that is not
// model state, and the one that is not model state by definition. Nothing is
// committed and nothing is on the undo stack yet.
describe('renderMap drawing a pending teleport', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const pendingStroke = (strokes: { style: string }[]) =>
    strokes.filter((stroke) => stroke.style === '#transition')

  // The origin is always a room cell, so every scene here has one, and
  // `renderMap` draws nothing at all without a map.
  function onAMap(pendingTeleport: MapScene['pendingTeleport']): Partial<MapScene> {
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['1,1'], { areaId: WORLD_AREA_ID })
    })
    return { map, areas: project.areas, lockTypes: project.lockTypes, pendingTeleport }
  }

  // The same square a finished endpoint fills, in the same place. That is the
  // whole design, so it is worth pinning the geometry rather than merely
  // counting strokes.
  it('outlines the marker the origin is going to become', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, onAMap('1,1'))

    const [outline] = pendingStroke(strokes)
    const inset = (TILE * (1 - 0.44)) / 2
    const near = TILE + inset
    const far = 2 * TILE - inset
    expect((outline as unknown as { segments: number[][] }).segments).toEqual([
      [near, near, far, near],
      [far, near, far, far],
      [far, far, near, far],
      [near, far, near, near],
    ])
  })

  // Hollow and dashed: a solid one would claim the teleport exists, and it
  // does not yet.
  it('draws it dashed, and never fills the cell', () => {
    const { ctx, strokes, fills } = fakeContext()

    draw(ctx, onAMap('1,1'))

    const [outline] = pendingStroke(strokes)
    expect((outline as unknown as { dash: number[] }).dash.length).toBeGreaterThan(0)
    expect(fills.some((fill) => fill.style === '#transition')).toBe(false)
  })

  it('draws nothing when no teleport is pending on this map', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, onAMap(null))

    expect(pendingStroke(strokes)).toEqual([])
  })

  // It shares a colour with a real endpoint, so "is it drawn" cannot be asked
  // by colour alone once one exists. It can be asked by count, which is what
  // this pins: the pending origin adds exactly one more mark.
  it('draws alongside the finished teleports rather than instead of them', () => {
    const withoutPending = fakeContext()
    const withPending = fakeContext()
    const teleports = {
      ends: [{ id: 'tr_x' as TransitionId, cell: '3,3', lock: OPEN_LOCK_ID, leadsTo: null }],
      lines: [],
    }

    draw(withoutPending.ctx, { ...onAMap(null), teleports })
    draw(withPending.ctx, { ...onAMap('1,1'), teleports })

    expect(pendingStroke(withPending.strokes).length).toBe(
      pendingStroke(withoutPending.strokes).length + 1,
    )
  })
})

// The selection halo: each selected transition's own shape, drawn wider and
// underneath it, in one warm colour for all three kinds.
describe('renderMap drawing the selection', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const halos = (strokes: { style: string }[]) =>
    strokes.filter((stroke) => stroke.style === '#selection')

  function twoRoomsAndADoor() {
    return withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, '0,0', '1,0'))
    })
  }

  function doorId(map: MapModel) {
    return [...map.transitions.values()][0].id
  }

  it('draws nothing when nothing is selected', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = twoRoomsAndADoor()

    draw(ctx, { map, areas: project.areas, lockTypes: project.lockTypes })

    expect(halos(strokes)).toEqual([])
  })

  // The case that decides the whole design: `Open` is colourless, so the
  // most common door in the app draws no marker at all, only the gap it
  // broke. A halo that merely thickened an existing mark would leave it
  // unable to look selected, which is why this draws the shape itself rather
  // than decorating one.
  it('marks a selected colourless door, which has no marker of its own', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = twoRoomsAndADoor()

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selected: new Set([doorId(map)]),
    })

    // No lock colour anywhere (the door is Open), and yet it is marked.
    expect(strokes.some((stroke) => stroke.style === '#e23b3b')).toBe(false)
    expect(halos(strokes)).toHaveLength(1)
  })

  // Under the thing it surrounds, so it reads as an outline rather than as a
  // blob covering it. Over the room fills, or the fill would eat it.
  it('draws the halo under the walls and the marker, and over the fills', () => {
    const { ctx, strokes, fills } = fakeContext()
    const { project, map } = twoRoomsAndADoor()

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selected: new Set([doorId(map)]),
    })

    const halo = strokes.findIndex((stroke) => stroke.style === '#selection')
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    expect(halo).toBeLessThan(wall)
    // And after the last room fill, which is what stops the fill covering it.
    expect(fills.at(-1)!.style).toBe('#roomfill')
  })

  it('draws it wider than the marker it surrounds', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
      setLock(tx, project, map, door.id, 'both', LOCKED_LOCK_ID)
    })

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selected: new Set([doorId(map)]),
    })

    const halo = halos(strokes)[0] as unknown as { width: number }
    const marker = strokes.find((stroke) => stroke.style === '#e23b3b') as unknown as {
      width: number
    }
    expect(halo.width).toBeGreaterThan(marker.width)
  })

  // An elevator is marked at both facing edges: the two things a user can
  // point at. The shaft between them is drawn behind the rooms and is not a
  // target.
  it('marks both ends of a selected elevator', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['4,0'], { areaId: WORLD_AREA_ID })
      ok(createFromBox(tx, project, map, '0,0', '4,0'))
    })

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selected: new Set([doorId(map)]),
    })

    expect(halos(strokes)).toHaveLength(2)
  })

  // A teleport is marked at its endpoints and not along its line: the line
  // can cross the whole map, and a full-length halo would be a stripe over
  // unrelated rooms rather than a mark on an object.
  it('marks a selected teleport at both endpoints, not along its line', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['5,5'], { areaId: WORLD_AREA_ID })
      ok(
        createTeleport(tx, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '5,5' }),
      )
    })
    const id = doorId(map)

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      teleports: teleportScene(project, map.id),
      selected: new Set([id]),
    })

    // Two filled squares, one behind each marker, and no stroked halo at all.
    expect(fills.filter((fill) => fill.style === '#selection')).toHaveLength(2)
    expect(halos(strokes)).toEqual([])
  })

  // The set is a filter, so a selection naming something else on the map leaves
  // this transition alone.
  it('marks only the transitions in the set', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = twoRoomsAndADoor()

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selected: new Set(['tr_somethingelse' as TransitionId]),
    })

    expect(halos(strokes)).toEqual([])
  })
})

// A selected room's halo. Every fixture here is rooms only, so a `#selection`
// stroke can only be a room's: the transition halo above shares the colour, and
// telling them apart by line width would pin two constants together that have
// no reason to agree.
describe('renderMap drawing selected rooms', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // Generic, so the filtered strokes keep their widths and segments: this
  // describe asserts on both.
  const halos = <T extends { style: string }>(strokes: T[]) =>
    strokes.filter((stroke) => stroke.style === '#selection')

  // Two 1x2 rooms sharing the boundary at x=1.
  function twoRooms() {
    const built = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
    })
    const [left, right] = [...built.map.rooms.values()]
    return { ...built, left, right }
  }

  function onMap({ project, map }: { project: ProjectModel; map: MapModel }) {
    return { map, areas: project.areas, lockTypes: project.lockTypes }
  }

  it('draws nothing around a room that is not selected', () => {
    const { ctx, strokes } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, onMap(fixture))

    expect(halos(strokes)).toEqual([])
  })

  it('traces the whole outline of a selected room, and only that room', () => {
    const { ctx, strokes } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, { ...onMap(fixture), selectedRooms: new Set([fixture.left.id]) })

    const drawn = halos(strokes)
    expect(drawn).toHaveLength(1)
    // Six edges: a 1x2 room has two long sides and two ends, as four cell
    // edges plus two.
    expect(drawn[0].segments).toHaveLength(outerWalls(fixture.left).size)
  })

  // Under the wall, so the wall paints back over the middle of it and leaves a
  // ring rather than a slab. Over the fills, or they would eat it.
  it('draws the halo under the walls and over the fills', () => {
    const { ctx, strokes, fills } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, { ...onMap(fixture), selectedRooms: new Set([fixture.left.id]) })

    const halo = strokes.findIndex((stroke) => stroke.style === '#selection')
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    expect(halo).toBeLessThan(wall)
    expect(fills.at(-1)!.style).toBe('#roomfill')
  })

  // A screen measure, not a world one: the halo has to stay visible at the zoom
  // where the map is too small to read any other way.
  it('stands the same distance proud of the wall at every zoom', () => {
    for (const zoom of [0.4, 1, 3]) {
      const { ctx, strokes } = fakeContext()
      const fixture = twoRooms()

      draw(ctx, {
        ...onMap(fixture),
        camera: { pan: { x: 0, y: 0 }, zoom },
        selectedRooms: new Set([fixture.left.id]),
      })

      const halo = halos(strokes)[0]
      const wall = strokes.find((stroke) => stroke.style === '#roomwall')!
      expect(halo.width - wall.width).toBeCloseTo(6)
    }
  })

  // The reason each room gets its own path. A shared boundary is an outer wall
  // of both rooms, so tracing them separately draws it twice and the line
  // between the pair survives; one path over the union would drop exactly that
  // edge and merge two selected neighbours into a single blob.
  it('keeps two adjacent selected rooms reading as two', () => {
    const { ctx, strokes } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, {
      ...onMap(fixture),
      selectedRooms: new Set([fixture.left.id, fixture.right.id]),
    })

    const drawn = halos(strokes)
    expect(drawn).toHaveLength(2)
    // Both of them trace the seam at x=1. Asked as "some segment lies on that
    // line" rather than as an exact segment, because the boundary is an edge per
    // cell and which way each is traced is the wall derivation's business.
    for (const halo of drawn) {
      expect(halo.segments.some(([x1, , x2]) => x1 === TILE && x2 === TILE)).toBe(true)
    }
  })

  // The two treatments land on the same room the moment one room is selected in
  // Draw mode, so they have to compose: different colours, and on either side of
  // the walls rather than both in the same place.
  it('coexists with the resize handles on one room', () => {
    const { ctx, strokes } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, {
      ...onMap(fixture),
      selectedRooms: new Set([fixture.left.id]),
      handleRoom: {
        room: fixture.left,
        band: 6,
        vertexRadius: 5,
        hovered: null,
        pointerCell: null,
        handles: ALL_HANDLES,
      },
    })

    const halo = strokes.findIndex((stroke) => stroke.style === '#selection')
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    const handle = strokes.findIndex((stroke) => stroke.style === '#handle')
    expect(halo).toBeLessThan(wall)
    expect(wall).toBeLessThan(handle)
  })

  // A selection belonging to another tab reaches this far only if something
  // upstream is wrong, but the lookup has to miss quietly rather than throw.
  it('ignores an id no room on this map answers to', () => {
    const { ctx, strokes } = fakeContext()
    const fixture = twoRooms()

    draw(ctx, { ...onMap(fixture), selectedRooms: new Set(['room_elsewhere' as RoomId]) })

    expect(halos(strokes)).toEqual([])
  })
})

// The one selection mark that is not a halo: a tint per cell, and a single
// outline around the union rather than around each of them.
describe('renderMap drawing a cell selection', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const tints = <T extends { style: string }>(fills: T[]) =>
    fills.filter((fill) => fill.style === '#selectionfill')
  const outlines = <T extends { style: string }>(strokes: T[]) =>
    strokes.filter((stroke) => stroke.style === '#selection')

  // Two 2x1 rooms side by side, sharing the boundary at x=2, so a selection can
  // span both of them.
  //
  //   room L (0,0)(1,0)   room R (2,0)(3,0)
  function twoRooms() {
    const built = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['2,0', '3,0'], { areaId: WORLD_AREA_ID })
    })
    return { map: built.map, areas: built.project.areas, lockTypes: built.project.lockTypes }
  }

  it('draws nothing when no cell is selected', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, twoRooms())

    expect(tints(fills)).toEqual([])
    expect(outlines(strokes)).toEqual([])
  })

  it('tints each selected cell, and only those', () => {
    const { ctx, fills } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['1,0', '2,0']) })

    expect(tints(fills).map((fill) => fill.rect)).toEqual([
      [TILE, 0, TILE, TILE],
      [2 * TILE, 0, TILE, TILE],
    ])
  })

  // The rule that makes a swept region read as one thing: two selected cells
  // side by side are one region, so the seam between them goes. This is the
  // opposite of the room halo, where two adjacent selected rooms stay two.
  it('outlines the union in one path, without the seam between neighbours', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['1,0', '2,0']) })

    const drawn = outlines(strokes)
    expect(drawn).toHaveLength(1)
    // Six edges for a 2x1 region, and the seam at x=2 is not one of them.
    expect(drawn[0].segments).toHaveLength(6)
    expect(drawn[0].segments).not.toContainEqual([2 * TILE, 0, 2 * TILE, TILE])
  })

  // A selection spanning two rooms is one region: the wall between them is the
  // rooms' business, and the outline says what was selected, not what owns it.
  it('spans two rooms as one outline', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['0,0', '1,0', '2,0', '3,0']) })

    const drawn = outlines(strokes)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].segments).toHaveLength(10)
  })

  // Still one path, and it holds both boundaries: a scattered selection reads
  // as the several regions it is, with no connectivity walk anywhere.
  it('keeps two clumps apart in the same path', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['0,0', '3,0']) })

    const drawn = outlines(strokes)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].segments).toHaveLength(8)
  })

  // Under the walls and over the fills, the slot the room halo sits in: the
  // tint marks cells, and a wall drawn over it stays crisp.
  it('draws under the walls and over the room fills', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['0,0']) })

    const outline = strokes.findIndex((stroke) => stroke.style === '#selection')
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    expect(outline).toBeLessThan(wall)
    const tint = fills.findIndex((fill) => fill.style === '#selectionfill')
    const roomFill = fills.findIndex((fill) => fill.style === '#roomfill')
    expect(roomFill).toBeLessThan(tint)
  })

  // The same screen measure the room halo stands proud by, so the two selection
  // marks read as one language at any zoom.
  it('stands the same distance proud of the wall at every zoom', () => {
    for (const zoom of [0.4, 1, 3]) {
      const { ctx, strokes } = fakeContext()

      draw(ctx, {
        ...twoRooms(),
        camera: { pan: { x: 0, y: 0 }, zoom },
        selectedCells: new Set<CellKey>(['0,0']),
      })

      const outline = outlines(strokes)[0]
      const wall = strokes.find((stroke) => stroke.style === '#roomwall')!
      expect(outline.width - wall.width).toBeCloseTo(6)
    }
  })

  // The cells are the whole of what a cell selection is: nothing resolves them
  // against the map, so a cell no room owns still draws.
  it('draws a cell no room owns', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, { ...twoRooms(), selectedCells: new Set<CellKey>(['9,9']) })

    expect(tints(fills)).toHaveLength(1)
    expect(outlines(strokes)[0].segments).toHaveLength(4)
  })
})

// The marquee: the only rectangle here whose interior is the meaning, which is
// why it is the only filled one.
describe('renderMap drawing the marquee', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const sheets = <T extends { style: string }>(fills: T[]) =>
    fills.filter((fill) => fill.style === '#marqueefill')

  // Every scene below is on a map: with none there is no page to sweep, and the
  // renderer stops before any of the overlays.
  function onAnEmptyMap(): Partial<MapScene> {
    const { project, map } = withMap(() => {})
    return { map, areas: project.areas, lockTypes: project.lockTypes }
  }

  it('draws nothing when no drag is live', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, onAnEmptyMap())

    expect(sheets(fills)).toEqual([])
    expect(strokes.some((stroke) => stroke.style === '#marquee')).toBe(false)
  })

  it('fills the swept rectangle and outlines it', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, { ...onAnEmptyMap(), marquee: { from: { x: 1, y: 2 }, to: { x: 4, y: 5 } } })

    expect(sheets(fills)).toEqual([
      { style: '#marqueefill', rect: [TILE, 2 * TILE, 3 * TILE, 3 * TILE] },
    ])
    const outline = strokes.find((stroke) => stroke.style === '#marquee')!
    expect(outline.segments).toContainEqual([TILE, 2 * TILE, 4 * TILE, 2 * TILE])
  })

  // The corners are the drag's origin and its current point, in that order and
  // no other: a drag running up and to the left has to cover the same ground as
  // the one that ran down and to the right.
  it('normalises a drag that runs backwards', () => {
    const { ctx, fills } = fakeContext()

    draw(ctx, { ...onAnEmptyMap(), marquee: { from: { x: 4, y: 5 }, to: { x: 1, y: 2 } } })

    expect(sheets(fills)[0].rect).toEqual([TILE, 2 * TILE, 3 * TILE, 3 * TILE])
  })

  // World coordinates, fractional, and no cell arithmetic on the way in:
  // whether the rectangle snaps to cells is the caller's to decide.
  it('takes its corners where they are, between cells included', () => {
    const { ctx, fills } = fakeContext()

    draw(ctx, { ...onAnEmptyMap(), marquee: { from: { x: 0.5, y: 0.5 }, to: { x: 2, y: 2 } } })

    expect(sheets(fills)[0].rect).toEqual([TILE / 2, TILE / 2, 1.5 * TILE, 1.5 * TILE])
  })

  // Over everything, including the halos the rooms under it are gaining as it
  // sweeps: it is the live gesture, and a translucent sheet only reads as one if
  // nothing is drawn on top of it.
  it('draws over the rooms it is sweeping', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
    })
    const room = [...map.rooms.values()][0]

    draw(ctx, {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      selectedRooms: new Set([room.id]),
      marquee: { from: { x: 0, y: 0 }, to: { x: 3, y: 3 } },
    })

    expect(fills.at(-1)!.style).toBe('#marqueefill')
    expect(strokes.at(-1)!.style).toBe('#marquee')
  })
})

// The View menu's per-layer visibility: a transitions master, and the
// teleport-lines sub-toggle nested under it.
//
// The nesting is asserted structurally, not as a conjunction. There is no
// "are lines effectively visible" value anywhere in the app: the lines are
// drawn inside the master's gate, so the test for it is that master-off hides
// them whatever the sub-toggle says, which is the last case below.
describe('renderMap layer visibility', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // Everything at once: a coloured door on a seam, an elevator across a gap and
  // a teleport between two rooms. One fixture, so each assertion below can say
  // "none of them" rather than testing one kind and trusting the rest.
  function everything() {
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '0,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['1,0', '1,1'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['5,0'], { areaId: WORLD_AREA_ID })
      const [door] = ok(createFromBox(tx, project, map, '0,0', '1,0'))
      // Coloured, so the marker has something to draw: an `Open` door's whole
      // rendering is the gap, which is tested by the seam assertions instead.
      setLock(tx, project, map, door.id, 'both', LOCKED_LOCK_ID)
      ok(createFromBox(tx, project, map, '1,0', '5,0'))
      ok(
        createTeleport(tx, project, { mapId: map.id, cell: '0,1' }, { mapId: map.id, cell: '5,0' }),
      )
    })
    return {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      teleports: teleportScene(project, map.id),
    }
  }

  // Wall drawn on the seam at x = 1, which is where the door broke it. The
  // same measurement the door tests use, and the reason it is here: the gap
  // is the door's own rendering, so hiding the layer has to give the wall
  // back.
  function seamLength(strokes: { style: string; segments: number[][] }[]): number {
    let total = 0
    for (const stroke of strokes) {
      if (stroke.style !== '#roomwall') continue
      for (const [x0, y0, x1, y1] of stroke.segments) {
        if (x0 === TILE && x1 === TILE) total += Math.abs(y1 - y0)
      }
    }
    return total
  }

  it('draws every kind with both toggles on', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, everything())

    expect(strokes.some((stroke) => stroke.style === '#e23b3b')).toBe(true)
    expect(fills.some((fill) => fill.style === '#transition')).toBe(true)
    expect(strokes.some((stroke) => stroke.style === '#teleportline')).toBe(true)
  })

  it('hides every kind when the transitions layer is off', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, { ...everything(), showTransitions: false })

    // The door's marker, the shaft and both teleport markers (all `fillRect` in
    // the transition colour), and the connecting line.
    expect(strokes.some((stroke) => stroke.style === '#e23b3b')).toBe(false)
    expect(fills.some((fill) => fill.style === '#transition')).toBe(false)
    expect(strokes.some((stroke) => stroke.style === '#teleportline')).toBe(false)
  })

  // The case worth having a test of its own: a door is a hole in the wall,
  // not a decal on it, so hiding the layer without closing the gap would
  // leave a wall with an unexplained opening, the layer off while its most
  // visible effect stays on screen.
  it('closes the doorway back up, leaving the wall whole', () => {
    const { ctx, strokes } = fakeContext()
    const shown = fakeContext()

    draw(ctx, { ...everything(), showTransitions: false })
    draw(shown.ctx, everything())

    // Two rooms, two edges each: the entire seam, drawn by both sides.
    expect(seamLength(strokes)).toBeCloseTo(4 * TILE)
    // And it really was broken with the layer on, or the line above proves
    // nothing: a door that never broke the wall would pass it too.
    expect(seamLength(shown.strokes)).toBeLessThan(4 * TILE)
  })

  it('hides the selection halo with the layer', () => {
    const { ctx, strokes } = fakeContext()
    const base = everything()
    const selected = new Set([...base.map!.transitions.values()].map((t) => t.id))

    draw(ctx, { ...base, selected, showTransitions: false })

    expect(strokes.some((stroke) => stroke.style === '#selection')).toBe(false)
  })

  // The teleport halo is the one that would survive an emptied door/shaft
  // list, because `drawSelection` reads `scene.teleports` directly: without
  // the gate on the call it would be an orange ring around nothing.
  it('hides a selected teleport, whose halo is not derived from the map', () => {
    const { ctx, fills } = fakeContext()
    const base = everything()
    const teleport = [...base.map!.transitions.values()].find((t) => t.kind === 'teleport')!

    draw(ctx, { ...base, selected: new Set([teleport.id]), showTransitions: false })

    expect(fills.some((fill) => fill.style === '#selection')).toBe(false)
  })

  // The live gesture is not the map. Hiding a layer says what the map shows,
  // and it must not swallow the mark that says the app is waiting on you.
  it('still draws a pending teleport with the layer off', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...everything(), showTransitions: false, pendingTeleport: '0,0' })

    expect(strokes.some((stroke) => stroke.style === '#transition')).toBe(true)
  })

  it('still draws the box preview with the layer off', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, {
      ...everything(),
      showTransitions: false,
      boxPreview: { from: '0,0', to: '1,1', outcome: 'edge' },
    })

    expect(strokes.some((stroke) => stroke.style === '#brush')).toBe(true)
  })

  it('hides only the connecting line when the sub-toggle is off', () => {
    const { ctx, fills, strokes } = fakeContext()

    draw(ctx, { ...everything(), showTeleportLines: false })

    expect(strokes.some((stroke) => stroke.style === '#teleportline')).toBe(false)
    // Both endpoints stay: a teleport with its line hidden is still an object
    // in two places. Hiding the markers as well would be the master toggle.
    const markers = fills.filter((fill) => fill.style === '#transition')
    expect(markers.length).toBeGreaterThanOrEqual(2)
  })

  // The arrow is drawn on the line, at its midpoint, so it belongs to the
  // line rather than to the endpoints: it goes with the sub-toggle.
  it('hides a one-way teleport arrow with its line', () => {
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['5,5'], { areaId: WORLD_AREA_ID })
      const teleport = ok(
        createTeleport(tx, project, { mapId: map.id, cell: '0,0' }, { mapId: map.id, cell: '5,5' }),
      )
      setDirection(tx, project, map, teleport.id, 'aToB')
    })
    const base = {
      map,
      areas: project.areas,
      lockTypes: project.lockTypes,
      teleports: teleportScene(project, map.id),
    }

    const shown = fakeContext()
    draw(shown.ctx, base)
    const hidden = fakeContext()
    draw(hidden.ctx, { ...base, showTeleportLines: false })

    // The arrow strokes in the transition colour; the endpoint markers fill in
    // it, so this counts the arrow and nothing else.
    expect(shown.strokes.some((stroke) => stroke.style === '#transition')).toBe(true)
    expect(hidden.strokes.some((stroke) => stroke.style === '#transition')).toBe(false)
    expect(hidden.fills.filter((fill) => fill.style === '#transition')).toHaveLength(2)
  })

  // The nesting rule, and the reason nothing computes a conjunction: with the
  // master off there is no path that reaches the line, whatever the sub-toggle
  // is left saying.
  it('keeps lines hidden with the master off and the sub-toggle on', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...everything(), showTransitions: false, showTeleportLines: true })

    expect(strokes.some((stroke) => stroke.style === '#teleportline')).toBe(false)
  })
})

// A destructive merge needs no confirmation and no toggle because you see
// what you are about to eat before you release.
describe('renderMap ghost overlay', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  function twoRooms() {
    return withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      paintCells(tx, project, map, ['2,0', '2,1'], { areaId: WORLD_AREA_ID })
    })
  }

  it('tints the cells a gesture is about to absorb', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = twoRooms()

    draw(ctx, {
      map,
      areas: project.areas,
      ghost: { absorbing: new Set(['2,0', '2,1']), becoming: new Set() },
    })

    const tinted = fills.filter((fill) => fill.style === '#absorb')
    expect(tinted).toHaveLength(2)
    expect(tinted[0].rect[2]).toBeCloseTo(TILE)
  })

  // Over the fills so the cells read as marked, under the walls so the walls
  // stay crisp rather than being washed out by the tint.
  it('paints over the room fills but leaves the walls on top', () => {
    const { ctx, fills } = fakeContext()
    const { project, map } = twoRooms()

    // Grid off, so the only strokes left are walls: otherwise the first
    // stroke recorded is the grid's, which is drawn under everything.
    draw(ctx, {
      map,
      areas: project.areas,
      showGrid: false,
      ghost: { absorbing: new Set(['2,0']), becoming: new Set() },
    })

    expect(fills.at(-1)!.style).toBe('#absorb')
    expect(ctx.stroke).toHaveBeenCalled()
    const strokeOrder = ctx.stroke.mock.invocationCallOrder[0]
    const tintOrder = ctx.fillRect.mock.invocationCallOrder.at(-1)!
    expect(tintOrder).toBeLessThan(strokeOrder)
  })

  it('draws nothing when there is no gesture, and nothing when it absorbs nothing', () => {
    const withoutGhost = fakeContext()
    const withEmptyGhost = fakeContext()
    const { project, map } = twoRooms()

    draw(withoutGhost.ctx, { map, areas: project.areas })
    draw(withEmptyGhost.ctx, {
      map,
      areas: project.areas,
      ghost: { absorbing: new Set(), becoming: new Set() },
    })

    expect(withoutGhost.fills.map((f) => f.style)).toEqual(withEmptyGhost.fills.map((f) => f.style))
    expect(withEmptyGhost.fills.some((fill) => fill.style === '#absorb')).toBe(false)
  })
})

// The other half of the ghost, and the only part of it that is not about
// destruction: which cells are about to stop being part of the rooms they are
// in and start being rooms of their own.
describe('renderMap ghost, cells about to become rooms', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const dashed = <T extends { style: string; dash: number[] }>(strokes: T[]) =>
    strokes.filter((stroke) => stroke.style === '#selection' && stroke.dash.length > 0)

  function oneRoom() {
    const built = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0', '2,0', '3,0'], { areaId: WORLD_AREA_ID })
    })
    return { map: built.map, areas: built.project.areas }
  }

  const ghostOf = (becoming: CellKey[]) => ({
    absorbing: new Set<CellKey>(),
    becoming: new Set(becoming),
  })

  it('draws nothing when the gesture becomes nothing', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...oneRoom(), ghost: ghostOf([]) })

    expect(dashed(strokes)).toEqual([])
  })

  it('outlines the landing cells, dashed', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...oneRoom(), ghost: ghostOf(['0,2', '1,2']) })

    const drawn = dashed(strokes)
    expect(drawn).toHaveLength(1)
    // Six edges for a 2x1 region: the seam between the pair is interior.
    expect(drawn[0].segments).toHaveLength(6)
  })

  // The count is half of what the user needs before releasing: a fragment in
  // two pieces lands as two rooms, and one outline around both would say one.
  it('outlines each connected group separately', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...oneRoom(), ghost: ghostOf(['0,2', '2,2']) })

    const drawn = dashed(strokes)
    expect(drawn).toHaveLength(2)
    for (const outline of drawn) expect(outline.segments).toHaveLength(4)
  })

  // Solid means this is a room and stays one; dashed means this is about to
  // become one. Same colour, same weight, so the dash is the whole signal.
  it('matches the room halo in colour and weight, and differs only in the dash', () => {
    const { ctx, strokes } = fakeContext()
    const built = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
    })
    const [room] = [...built.map.rooms.values()]

    draw(ctx, {
      map: built.map,
      areas: built.project.areas,
      selectedRooms: new Set([room.id]),
      ghost: ghostOf(['0,2']),
    })

    const halo = strokes.find(
      (stroke) => stroke.style === '#selection' && stroke.dash.length === 0,
    )!
    const becoming = dashed(strokes)[0]
    expect(becoming.width).toBeCloseTo(halo.width)
  })

  // Over the walls, unlike every other outline here: the new rooms' own walls
  // are drawn solid on the same boundary, and a preview hidden by the thing it
  // previews says nothing.
  it('draws over the walls', () => {
    const { ctx, strokes } = fakeContext()

    draw(ctx, { ...oneRoom(), ghost: ghostOf(['0,0', '1,0']) })

    const becoming = strokes.findIndex(
      (stroke) => stroke.style === '#selection' && stroke.dash.length > 0,
    )
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    expect(wall).toBeLessThan(becoming)
  })
})

// The aiming aid for a sized brush. The component gates it on N > 1; the
// renderer's job is only to draw whatever it is handed.
describe('renderMap brush preview', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  function room() {
    return withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )
  }

  it('draws nothing when there is no preview', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room()

    draw(ctx, { map, areas: project.areas, brushPreview: null })

    expect(strokes.some((stroke) => stroke.style === '#brush')).toBe(false)
  })

  it('outlines the footprint as one rectangle at the page scale', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room()

    draw(ctx, { map, areas: project.areas, brushPreview: { col: 2, row: 3, size: 3 } })

    const outline = strokes.find((stroke) => stroke.style === '#brush')!
    expect(outline).toBeDefined()
    // Four sides, and no path per cell: the square brush is one rectangle.
    expect(outline.segments).toHaveLength(4)

    const xs = outline.segments.flatMap(([x0, , x1]) => [x0, x1])
    const ys = outline.segments.flatMap(([, y0, , y1]) => [y0, y1])
    expect(Math.min(...xs)).toBeCloseTo(2 * TILE)
    expect(Math.max(...xs)).toBeCloseTo(5 * TILE)
    expect(Math.min(...ys)).toBeCloseTo(3 * TILE)
    expect(Math.max(...ys)).toBeCloseTo(6 * TILE)
  })

  // It is a cursor, not part of the map: one crisp screen pixel at every zoom,
  // rather than the zoom-tracking weight walls use.
  it('keeps a hairline weight independent of zoom', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room()

    draw(ctx, {
      map,
      areas: project.areas,
      camera: { pan: { x: 0, y: 0 }, zoom: 4 },
      brushPreview: { col: 0, row: 0, size: 2 },
    })

    expect(strokes.find((stroke) => stroke.style === '#brush')!.width).toBe(1)
  })

  it('draws it over the walls rather than under them', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room()

    draw(ctx, { map, areas: project.areas, brushPreview: { col: 0, row: 0, size: 2 } })

    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    const brush = strokes.findIndex((stroke) => stroke.style === '#brush')
    expect(wall).toBeGreaterThanOrEqual(0)
    expect(brush).toBeGreaterThan(wall)
  })
})

// Draw/Edit's active room. The hovered handle is drawn at the size drawZone
// grabs it at, which is the point: a handle that disagrees with its own hit
// zone is worse than no handle. Idle handles are smaller hints, sized below.
describe('renderMap active room handles', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  // 3x3: every side is a run of 3, and it has four interior vertices.
  function room3x3() {
    return withMap((tx, project, map) =>
      paintCells(
        tx,
        project,
        map,
        ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'],
        { areaId: WORLD_AREA_ID },
      ),
    )
  }

  // The reveal window is centred on cell (1,1), which covers every interior
  // vertex of the 3x3 room used below.
  function activeScene(map: MapModel, roomId: string, hovered: HoveredHandle | null = null) {
    return {
      room: map.rooms.get(roomId as never)!,
      band: 5,
      vertexRadius: 7,
      handles: ALL_HANDLES,
      hovered,
      pointerCell: { x: 1, y: 1 },
    }
  }

  it('draws nothing when no room is armed', () => {
    const { ctx, fills, strokes } = fakeContext()
    const { project, map } = room3x3()

    draw(ctx, { map, areas: project.areas, handleRoom: null })

    expect(strokes.some((stroke) => stroke.style === '#handle')).toBe(false)
    expect(fills.some((fill) => fill.style === '#handle')).toBe(false)
  })

  it('draws one handle per resizable run, spanning the whole run', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room3x3()
    const roomId = [...map.rooms.keys()][0]

    draw(ctx, { map, areas: project.areas, handleRoom: activeScene(map, roomId) })

    // One stroke per run, because each can be at a different weight: the
    // hovered one is inflated and the rest stay faint.
    const handles = strokes.filter((stroke) => stroke.style === '#handle')
    expect(handles).toHaveLength(4)
    for (const handle of handles) {
      expect(handle.segments).toHaveLength(1)
      const [x0, y0, x1, y1] = handle.segments[0]
      // Each spans three cells, not one edge.
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(3 * TILE)
    }
  })

  // Idle handles are hints, sized against the cell so they shrink with zoom
  // and all but vanish below 100%. Sizing them at their grab size instead
  // would turn a large room into a lattice of handles.
  describe('idle weight', () => {
    it('draws run handles far thinner than their grab band', () => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = room3x3()
      const roomId = [...map.rooms.keys()][0]

      draw(ctx, { map, areas: project.areas, handleRoom: activeScene(map, roomId) })

      const width = strokes.find((stroke) => stroke.style === '#handle')!.width
      expect(width).toBeLessThan(5 * 2)
      expect(width).toBeCloseTo(TILE * 0.09)
    })

    it('draws vertex targets far smaller than their grab radius', () => {
      const { ctx, fills } = fakeContext()
      const { project, map } = room3x3()
      const roomId = [...map.rooms.keys()][0]

      draw(ctx, { map, areas: project.areas, handleRoom: activeScene(map, roomId) })

      const targets = fills.filter((fill) => fill.style === '#handle')
      // A 3x3 room's interior vertices are (1,1), (2,1), (1,2), (2,2).
      expect(targets).toHaveLength(4)
      for (const target of targets) {
        expect(target.rect[2]).toBeLessThan(7 * 2)
        expect(target.rect[2]).toBeCloseTo(TILE * 0.07 * 2)
      }
    })

    // The whole point of scaling against the cell: zoom out and they recede.
    it('shrinks with the zoom rather than holding a screen size', () => {
      const { ctx, fills } = fakeContext()
      const { project, map } = room3x3()
      const roomId = [...map.rooms.keys()][0]

      draw(ctx, {
        map,
        areas: project.areas,
        camera: { pan: { x: 0, y: 0 }, zoom: 0.5 },
        handleRoom: activeScene(map, roomId),
      })

      const target = fills.find((fill) => fill.style === '#handle')!
      expect(target.rect[2]).toBeCloseTo(TILE * 0.5 * 0.07 * 2)
    })
  })

  // Interior vertex targets are revealed only in a window around the
  // pointer's cell, not all of them at once: a 20x20 room has 361 interior
  // vertices, and drawing every one at once would turn it into a lattice.
  describe('vertex reveal window', () => {
    // 10x10, so its 81 interior vertices comfortably exceed the 25 a single
    // 5x5 window can hold: a smaller room would fit entirely inside the
    // window and the filter would look like it worked while doing nothing.
    function room10x10() {
      const cells: string[] = []
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) cells.push(`${x},${y}`)
      return withMap((tx, project, map) =>
        paintCells(tx, project, map, cells, { areaId: WORLD_AREA_ID }),
      )
    }

    function targetsAround(pointerCell: { x: number; y: number } | null) {
      const { ctx, fills } = fakeContext()
      const { project, map } = room10x10()
      const room = [...map.rooms.values()][0]
      draw(ctx, {
        map,
        areas: project.areas,
        handleRoom: {
          room,
          band: 5,
          vertexRadius: 7,
          handles: ALL_HANDLES,
          hovered: null,
          pointerCell,
        },
      })
      return fills.filter((fill) => fill.style === '#handle')
    }

    it('draws only the vertices near the pointer, not all of them', () => {
      const room = [...room10x10().map.rooms.values()][0]
      expect(interiorVertices(room)).toHaveLength(81)

      // A 5x5 window well inside the room: 25 of the 81.
      expect(targetsAround({ x: 5, y: 5 })).toHaveLength(25)
      // Against a corner the window overhangs the room and reveals fewer.
      expect(targetsAround({ x: 0, y: 0 })).toHaveLength(4)
    })

    it('moves the window with the pointer', () => {
      const nearTopLeft = targetsAround({ x: 2, y: 2 })
      const nearBottomRight = targetsAround({ x: 8, y: 8 })

      expect(nearTopLeft.length).toBeGreaterThan(0)
      expect(nearBottomRight.length).toBeGreaterThan(0)
      // Different windows, so different targets.
      expect(nearTopLeft[0].rect[0]).not.toBeCloseTo(nearBottomRight[0].rect[0])
    })

    // No pointer on the canvas reveals nothing. The run handles still show, so
    // the room is visibly armed either way.
    it('draws no vertex targets with no pointer', () => {
      expect(targetsAround(null)).toHaveLength(0)
    })

    it('still draws the run handles with no pointer', () => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = room10x10()
      const room = [...map.rooms.values()][0]

      draw(ctx, {
        map,
        areas: project.areas,
        handleRoom: {
          room,
          band: 5,
          vertexRadius: 7,
          handles: ALL_HANDLES,
          hovered: null,
          pointerCell: null,
        },
      })

      expect(strokes.filter((stroke) => stroke.style === '#handle')).toHaveLength(4)
    })
  })

  // The hovered one inflates to exactly the region that will catch the
  // pointer: this is where handle and grab zone are kept in agreement.
  describe('the hovered handle', () => {
    it('inflates a run to its full grab band, in the hover colour', () => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = room3x3()
      const room = [...map.rooms.values()][0]
      const northRun = resizableRuns(room).find((run) => run.side === 'N')!

      draw(ctx, {
        map,
        areas: project.areas,
        handleRoom: {
          room,
          band: 5,
          vertexRadius: 7,
          handles: ALL_HANDLES,
          hovered: { kind: 'run', edge: northRun.edges[0] },
          pointerCell: { x: 1, y: 1 },
        },
      })

      const hovered = strokes.find((stroke) => stroke.style === '#handlehover')!
      expect(hovered).toBeDefined()
      expect(hovered.width).toBe(10)
      // The other three stay faint.
      expect(strokes.filter((stroke) => stroke.style === '#handle')).toHaveLength(3)
    })

    it('inflates a vertex to its grab radius, in the hover colour', () => {
      const { ctx, fills } = fakeContext()
      const { project, map } = room3x3()
      const room = [...map.rooms.values()][0]

      draw(ctx, {
        map,
        areas: project.areas,
        handleRoom: {
          room,
          band: 5,
          vertexRadius: 7,
          handles: ALL_HANDLES,
          hovered: { kind: 'vertex', vertex: { x: 1, y: 1 } },
          pointerCell: { x: 1, y: 1 },
        },
      })

      const hovered = fills.filter((fill) => fill.style === '#handlehover')
      expect(hovered).toHaveLength(1)
      expect(hovered[0].rect[2]).toBeCloseTo(14)
      // The other three interior vertices stay faint.
      expect(fills.filter((fill) => fill.style === '#handle')).toHaveLength(3)
    })

    // A run is named by its first edge rather than by object identity,
    // because the derived runs are memoised on the room's revision: identity
    // would hold usually and break the moment the room changed mid-frame.
    it('matches a run by its first edge', () => {
      const { ctx, strokes } = fakeContext()
      const { project, map } = room3x3()
      const room = [...map.rooms.values()][0]

      draw(ctx, {
        map,
        areas: project.areas,
        handleRoom: {
          room,
          band: 5,
          vertexRadius: 7,
          handles: ALL_HANDLES,
          hovered: { kind: 'run', edge: 'nonsense' },
          pointerCell: { x: 1, y: 1 },
        },
      })

      expect(strokes.some((stroke) => stroke.style === '#handlehover')).toBe(false)
      expect(strokes.filter((stroke) => stroke.style === '#handle')).toHaveLength(4)
    })
  })

  it('draws no handle on a length-1 face', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = withMap((tx, project, map) =>
      paintCells(tx, project, map, ['0,0'], { areaId: WORLD_AREA_ID }),
    )
    const roomId = [...map.rooms.keys()][0]

    draw(ctx, {
      map,
      areas: project.areas,
      handleRoom: {
        room: map.rooms.get(roomId)!,
        band: 5,
        vertexRadius: 7,
        handles: ALL_HANDLES,
        hovered: null,
        pointerCell: { x: 1, y: 1 },
      },
    })

    const handles = strokes.find((stroke) => stroke.style === '#handle')
    expect(handles?.segments ?? []).toHaveLength(0)
  })

  it('draws the handles over the walls', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map } = room3x3()
    const roomId = [...map.rooms.keys()][0]

    draw(ctx, { map, areas: project.areas, handleRoom: activeScene(map, roomId) })

    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    const handle = strokes.findIndex((stroke) => stroke.style === '#handle')
    expect(wall).toBeGreaterThanOrEqual(0)
    expect(handle).toBeGreaterThan(wall)
  })
})

describe('renderMap drawing icons', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  function mapWithIcon(iconType: string, colors = TEST_ICON_COLORS) {
    return withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
      ok(placeIcon(tx, map, '1,0', iconType, colors))
    })
  }

  it('draws the plate then the glyph, each in the icon’s own colour', () => {
    const { ctx, badges } = fakeContext()
    const { project, map } = mapWithIcon('save', {
      plateColor: '#plate',
      glyphColor: '#glyph',
    })

    draw(ctx, { map, areas: project.areas })

    const art = iconArtCatalogue().get('save')!
    // Plate first: the glyph has to read over it, and a sub-path wound against
    // its shape shows the plate through rather than the room.
    expect(badges).toEqual([
      expect.objectContaining({ style: '#plate', data: art.plate }),
      expect.objectContaining({ style: '#glyph', data: art.glyph }),
    ])
  })

  it('centres the badge in its cell and scales the viewBox to it', () => {
    const { ctx, badges } = fakeContext()
    const { project, map } = mapWithIcon('save')

    draw(ctx, { map, areas: project.areas })

    // The icon is on (1,0), so its cell starts one tile in.
    const size = TILE * 0.8
    const margin = (TILE - size) / 2
    expect(badges[0].x).toBeCloseTo(TILE + margin)
    expect(badges[0].y).toBeCloseTo(margin)
    // A viewBox unit maps to size/ICON_VIEWBOX pixels, so the badge fills
    // exactly `size` however the viewBox is later re-cut.
    expect(badges[0].scale).toBeCloseTo(size / ICON_VIEWBOX)
  })

  it('tracks zoom, because the badge belongs to the map rather than the screen', () => {
    const { ctx, badges } = fakeContext()
    const { project, map } = mapWithIcon('save')

    draw(ctx, {
      map,
      areas: project.areas,
      camera: { pan: { x: 0, y: 0 }, zoom: 2 },
    })

    expect(badges[0].scale).toBeCloseTo((TILE * 2 * 0.8) / ICON_VIEWBOX)
  })

  it('draws an unrecognised type as the fallback, in the icon’s colours', () => {
    const { ctx, badges } = fakeContext()
    // A project saved with an icon this build has since renamed or removed.
    const { project, map } = mapWithIcon('no-such-icon-type', {
      plateColor: '#plate',
      glyphColor: '#glyph',
    })

    expect(() => draw(ctx, { map, areas: project.areas })).not.toThrow()

    // Visible, and unmistakably not one of the real icons. The colours are
    // still the user's: only the art is substituted.
    expect(badges).toEqual([
      expect.objectContaining({ style: '#plate', data: UNKNOWN_ICON_ART.plate }),
      expect.objectContaining({ style: '#glyph', data: UNKNOWN_ICON_ART.glyph }),
    ])
  })

  it('draws icons over the walls', () => {
    const { ctx, strokes, badges } = fakeContext()
    const { project, map } = mapWithIcon('save')

    draw(ctx, { map, areas: project.areas })

    // Paint order matches Markup's hit priority: a click in the cell finds the
    // icon, so the icon has to be what is on top.
    expect(strokes.some((stroke) => stroke.style === '#roomwall')).toBe(true)
    expect(badges).toHaveLength(2)
  })

  it('takes art from the scene, so a build with no catalogue still draws', () => {
    const { ctx, badges } = fakeContext()
    const { project, map } = mapWithIcon('save')

    // An empty catalogue is the same case as an unknown type: the renderer
    // holds no registry of its own to fall back on. `save` is a real entry, so
    // reaching for the registry rather than the scene would draw the floppy.
    draw(ctx, { map, areas: project.areas, iconArt: new Map() })

    // The glyph, not the plate: every real icon shares the standard plate with
    // the fallback, so the plate cannot tell the two apart.
    expect(getIcon('save')).toBeDefined()
    expect(badges[1].data).toBe(UNKNOWN_ICON_ART.glyph)
    expect(badges[1].data).not.toBe(getIcon('save')!.glyph)
  })
})

describe('renderMap drawing lines', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const STYLE = { color: '#line', arrowStart: false, arrowEnd: false }

  // Cell centres in screen px at zoom 1: the tile's midpoint, no rooms needed.
  const centre = (x: number, y: number) => [TILE * (x + 0.5), TILE * (y + 0.5)]

  function mapWithLine(points: CellKey[], style: Partial<typeof STYLE> = {}) {
    return withMap((tx, _project, map) => {
      ok(createLine(tx, map, points, { ...STYLE, ...style }))
    })
  }

  function lineStroke(strokes: { style: string; join: string; segments: number[][] }[]) {
    return strokes.find((stroke) => stroke.style === '#line')!
  }

  it('joins the centres of the cells it was drawn across', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,0', '2,0'])

    draw(ctx, { map })

    expect(lineStroke(strokes).segments).toEqual([
      [...centre(0, 0), ...centre(1, 0)],
      [...centre(1, 0), ...centre(2, 0)],
    ])
  })

  it('draws diagonal steps as diagonals, not as a staircase', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,1', '2,2'])

    draw(ctx, { map })

    // Two segments, each crossing both axes at once. A staircase would be four.
    expect(lineStroke(strokes).segments).toEqual([
      [...centre(0, 0), ...centre(1, 1)],
      [...centre(1, 1), ...centre(2, 2)],
    ])
  })

  it('rounds its joins, so a doubling-back step cannot throw a mitre spike', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,0', '0,0'])

    draw(ctx, { map })

    expect(lineStroke(strokes).join).toBe('round')
  })

  it('takes its colour and weight from the line, and scales weight with zoom', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,0'], { color: '#abcdef' })

    draw(ctx, { map, camera: { pan: { x: 0, y: 0 }, zoom: 2 } })

    const stroke = strokes.find((candidate) => candidate.style === '#abcdef')!
    expect(stroke).toBeDefined()
    expect(stroke.width).toBeCloseTo(6)
  })

  it('gives each line its own colour rather than batching them into one path', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = withMap((tx, _project, map) => {
      ok(createLine(tx, map, ['0,0', '1,0'], { ...STYLE, color: '#first' }))
      ok(createLine(tx, map, ['0,3', '1,3'], { ...STYLE, color: '#second' }))
    })

    draw(ctx, { map })

    expect(strokes.some((stroke) => stroke.style === '#first')).toBe(true)
    expect(strokes.some((stroke) => stroke.style === '#second')).toBe(true)
  })

  it('draws an arrowhead only at the ends that ask for one', () => {
    const both = fakeContext()
    const neither = fakeContext()
    const { map: withArrows } = mapWithLine(['0,0', '1,0'], {
      arrowStart: true,
      arrowEnd: true,
    })
    const { map: without } = mapWithLine(['0,0', '1,0'])

    draw(both.ctx, { map: withArrows })
    draw(neither.ctx, { map: without })

    // One stroke for the line itself, plus one chevron per armed end.
    expect(both.strokes.filter((stroke) => stroke.style === '#line')).toHaveLength(3)
    expect(neither.strokes.filter((stroke) => stroke.style === '#line')).toHaveLength(1)
  })

  it('points the end arrow along the last segment, away from the line', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,0', '2,0'], { arrowEnd: true })

    draw(ctx, { map })

    // The chevron is two lines meeting at an apex; the apex sits past the last
    // cell centre in the direction of travel, which here is due east.
    const head = strokes.filter((stroke) => stroke.style === '#line').at(-1)!
    const apex = head.segments[0].slice(2)
    expect(apex[0]).toBeGreaterThan(centre(2, 0)[0])
    expect(apex[1]).toBeCloseTo(centre(2, 0)[1])
  })

  it('points the start arrow the other way', () => {
    const { ctx, strokes } = fakeContext()
    const { map } = mapWithLine(['0,0', '1,0', '2,0'], { arrowStart: true })

    draw(ctx, { map })

    const head = strokes.filter((stroke) => stroke.style === '#line').at(-1)!
    const apex = head.segments[0].slice(2)
    expect(apex[0]).toBeLessThan(centre(0, 0)[0])
  })

  it('draws a line that touches no room at all', () => {
    const { ctx, strokes } = fakeContext()
    // No rooms exist. Lines are an independent overlay with no room owner, so
    // there is nothing for this one to be attached to or clipped by.
    const { map } = mapWithLine(['5,5', '6,6'])

    draw(ctx, { map })

    expect(lineStroke(strokes).segments).toHaveLength(1)
  })

  it('draws lines over the walls and icons over the lines', () => {
    const { ctx, strokes, badges } = fakeContext()
    const { project, map } = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
      ok(createLine(tx, map, ['0,0', '1,0'], STYLE))
      ok(placeIcon(tx, map, '0,0', 'save', TEST_ICON_COLORS))
    })

    draw(ctx, { map, areas: project.areas })

    // Paint order is Markup's hit priority read backwards: the icon is on top
    // because a click in that cell finds the icon, not the line under it.
    const wall = strokes.findIndex((stroke) => stroke.style === '#roomwall')
    const line = strokes.findIndex((stroke) => stroke.style === '#line')
    expect(line).toBeGreaterThan(wall)
    expect(badges).toHaveLength(2)
  })
})

describe('renderMap markup layers and labels', () => {
  const draw = (ctx: unknown, overrides: Partial<MapScene>) =>
    renderMap(ctx as CanvasRenderingContext2D, 800, 600, scene(overrides))

  const STYLE = { color: '#line', arrowStart: false, arrowEnd: false }

  // One icon on (1,0) and one line across (0,2) to (2,2), far enough apart that
  // a label on either can be identified by its text alone.
  function markup(iconLabel = '', lineLabel = '') {
    let iconId!: IconId
    let lineId!: LineId
    const built = withMap((tx, project, map) => {
      paintCells(tx, project, map, ['0,0', '1,0'], { areaId: WORLD_AREA_ID })
      iconId = ok(placeIcon(tx, map, '1,0', 'save', TEST_ICON_COLORS)).id
      lineId = ok(createLine(tx, map, ['0,2', '1,2', '2,2'], STYLE)).id
      if (iconLabel) setIconLabel(tx, map, iconId, iconLabel)
      if (lineLabel) setLineStyle(tx, map, lineId, 'label', lineLabel)
    })
    return { ...built, iconId, lineId }
  }

  it('hides icons and keeps lines when only the icons layer is off', () => {
    const { ctx, strokes, badges } = fakeContext()
    const { project, map } = markup()

    draw(ctx, { map, areas: project.areas, showIcons: false })

    expect(badges).toHaveLength(0)
    expect(strokes.some((stroke) => stroke.style === '#line')).toBe(true)
  })

  it('hides lines and keeps icons when only the lines layer is off', () => {
    const { ctx, strokes, badges } = fakeContext()
    const { project, map } = markup()

    draw(ctx, { map, areas: project.areas, showLines: false })

    expect(strokes.some((stroke) => stroke.style === '#line')).toBe(false)
    expect(badges).toHaveLength(2)
  })

  it('draws no label at all with the toggle off and nothing hovered', () => {
    const { ctx, labels } = fakeContext()
    const { project, map } = markup('Save Point', 'The Long Way')

    draw(ctx, { map, areas: project.areas })

    expect(labels).toEqual([])
  })

  it('draws every non-empty label under the show-all toggle', () => {
    const { ctx, labels, chips } = fakeContext()
    const { project, map } = markup('Save Point', 'The Long Way')

    draw(ctx, { map, areas: project.areas, showAllLabels: true })

    expect(labels.map((label) => label.text).sort()).toEqual(['Save Point', 'The Long Way'])
    // Text on a chip, in the two label colours: a label lands on room fills and
    // lines alike, so it carries its own background.
    expect(labels.every((label) => label.style === '#labeltext')).toBe(true)
    expect(chips.every((chip) => chip.style === '#labelplate')).toBe(true)
  })

  it('draws only the hovered object’s label while the toggle is off', () => {
    const { ctx, labels } = fakeContext()
    const { project, map, iconId } = markup('Save Point', 'The Long Way')

    draw(ctx, { map, areas: project.areas, hoveredLabel: iconId })

    expect(labels.map((label) => label.text)).toEqual(['Save Point'])
  })

  it('draws nothing for an object whose label is empty', () => {
    const { ctx, labels } = fakeContext()
    const { project, map, iconId } = markup('', 'The Long Way')

    // Hovered, and still silent: an empty label is every object's default, so a
    // chip with nothing in it would mark the whole map.
    draw(ctx, { map, areas: project.areas, hoveredLabel: iconId })

    expect(labels).toEqual([])
  })

  it('takes a label away with the layer that owns it', () => {
    const icons = fakeContext()
    const lines = fakeContext()
    const { project, map } = markup('Save Point', 'The Long Way')
    const shown = { map, areas: project.areas, showAllLabels: true }

    draw(icons.ctx, { ...shown, showIcons: false })
    draw(lines.ctx, { ...shown, showLines: false })

    expect(icons.labels.map((label) => label.text)).toEqual(['The Long Way'])
    expect(lines.labels.map((label) => label.text)).toEqual(['Save Point'])
  })

  it('puts an icon’s label under its badge and a line’s at its middle', () => {
    const { ctx, labels } = fakeContext()
    const { project, map } = markup('Save Point', 'The Long Way')

    draw(ctx, { map, areas: project.areas, showAllLabels: true })

    const icon = labels.find((label) => label.text === 'Save Point')!
    const line = labels.find((label) => label.text === 'The Long Way')!
    // Centred on the icon's cell horizontally, below the badge vertically.
    expect(icon.at[0]).toBeCloseTo(TILE * 1.5)
    expect(icon.at[1]).toBeGreaterThan(TILE)
    // Horizontally on the centre cell of a three-point line, which is the
    // middle vertex, and lifted clear of the stroke it names.
    expect(line.at[0]).toBeCloseTo(TILE * 1.5)
    expect(line.at[1]).toBeLessThan(TILE * 2.5)
  })

  it('haloes a selected line along its own path, under the line', () => {
    const { ctx, strokes } = fakeContext()
    const { project, map, lineId } = markup()

    draw(ctx, { map, areas: project.areas, selectedMarkup: new Set([lineId]) })

    const halo = strokes.findIndex((stroke) => stroke.style === '#selection')
    const line = strokes.findIndex((stroke) => stroke.style === '#line')
    // Under it, so the line paints back over the middle and leaves a ring.
    expect(halo).toBeGreaterThanOrEqual(0)
    expect(halo).toBeLessThan(line)
    // The same path, wider: a halo that traced it differently would fringe.
    expect(strokes[halo].segments).toEqual(strokes[line].segments)
    expect(strokes[halo].width).toBeGreaterThan(strokes[line].width)
  })

  it('haloes a selected icon with its own plate, under the badge', () => {
    const { ctx, badges } = fakeContext()
    const { project, map, iconId } = markup()

    draw(ctx, { map, areas: project.areas, selectedMarkup: new Set([iconId]) })

    const art = iconArtCatalogue().get('save')!
    // Plate, plate, glyph: the halo is the badge's own shape drawn first and
    // wider, so only its rim is ever seen.
    expect(badges.map((badge) => badge.style)).toEqual([
      '#selection',
      TEST_ICON_COLORS.plateColor,
      TEST_ICON_COLORS.glyphColor,
    ])
    expect(badges[0].data).toBe(art.plate)
    expect(badges[0].scale).toBeGreaterThan(badges[1].scale)
  })

  it('draws no halo for anything that is not selected', () => {
    const { ctx, strokes, badges } = fakeContext()
    const { project, map } = markup()

    draw(ctx, { map, areas: project.areas })

    expect(strokes.some((stroke) => stroke.style === '#selection')).toBe(false)
    expect(badges.every((badge) => badge.style !== '#selection')).toBe(true)
  })

  it('takes a halo away with the layer that owns it', () => {
    const icons = fakeContext()
    const lines = fakeContext()
    const { project, map, iconId, lineId } = markup()
    const selectedMarkup = new Set([iconId, lineId])
    const shown = { map, areas: project.areas, selectedMarkup }

    draw(icons.ctx, { ...shown, showIcons: false })
    draw(lines.ctx, { ...shown, showLines: false })

    // A ring around nothing would be worse than no ring.
    expect(icons.badges.every((badge) => badge.style !== '#selection')).toBe(true)
    expect(icons.strokes.some((stroke) => stroke.style === '#selection')).toBe(true)
    expect(lines.strokes.some((stroke) => stroke.style === '#selection')).toBe(false)
    expect(lines.badges.some((badge) => badge.style === '#selection')).toBe(true)
  })

  it('puts an even-length line’s label between its two central cells', () => {
    const { ctx, labels } = fakeContext()
    const { map } = withMap((tx, _project, map) => {
      const line = ok(createLine(tx, map, ['0,2', '1,2', '2,2', '3,2'], STYLE))
      setLineStyle(tx, map, line.id, 'label', 'Even')
    })

    draw(ctx, { map, showAllLabels: true })

    // Between (1,2) and (2,2): the midpoint of the two vertices either side of
    // centre, so the chip sits over the line rather than over one of its steps.
    expect(labels[0].at[0]).toBeCloseTo(TILE * 2)
  })
})
