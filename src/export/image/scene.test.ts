import { describe, expect, it } from 'vitest'
import { renderMap, type MapScene } from '@/canvas/renderMap'
import { createRecordingContext, type RecordedStroke } from '@/canvas/testContext'
import { PAGE_HOME, PAGE_PADDING } from '@/canvas/page'
import type { CanvasPalette } from '@/canvas/palette'
import { createFromBox, createTeleport, setDirection, setLock } from '@/core/ops/doors'
import { addMap } from '@/core/ops/maps'
import { createLine, placeIcon } from '@/core/ops/markup'
import { drawInnerWall, paintCells } from '@/core/ops/rooms'
import { refuse } from '@/core/outcome'
import { WORLD_AREA_ID } from '@/core/ids'
import type { LockTypeId, MapId, TransitionId } from '@/core/ids'
import { edgeKey, type CellKey } from '@/core/cell'
import type { Room } from '@/core/types'
import { ok, rect, setup, TEST_ICON_COLORS, tx } from '@/core/testUtils'
import { MARGIN_MAX, MARGIN_MIN } from './options'
import {
  buildExportScene,
  EXPORT_TILE_SIZE,
  exportRectangle,
  imageSize,
  INTERACTION_FIELDS,
  type ExportLayers,
  type ExportSceneOptions,
} from './scene'

// Deliberately unparseable, like the renderer's own test palette: a colour
// transform answers what it cannot read unchanged, so a real hex here would
// make an assertion about a derived colour vacuous. Nothing below asserts one.
const palette = {
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
  selection: '#selection',
  handle: '#handle',
  liquid: '#liquid',
} as unknown as CanvasPalette

// The one shipped editable lock type, and the only coloured thing a fresh
// project has.
const LOCKED_LOCK_ID = 'locked' as LockTypeId

const ALL_LAYERS: ExportLayers = {
  grid: true,
  transitions: true,
  teleportLines: true,
  icons: true,
  lines: true,
  allLabels: true,
}

function options(overrides: Partial<ExportSceneOptions> = {}): ExportSceneOptions {
  return {
    pxPerCell: 32,
    margin: 2,
    layers: ALL_LAYERS,
    palette,
    ...overrides,
  }
}

// A 2x2 room at the origin, on a project whose own tile size is deliberately
// not 32: the preset must be the drawn cell whatever the project displays at.
function twoByTwo() {
  const { project, map } = setup()
  const painting = tx(map)
  const room = paintCells(painting, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
  painting.commit()
  project.settings.tileSize = 20
  return { project, map, room }
}

// A map carrying one of everything whose stroke weight is clamped: a door
// marker, a one-way arrowhead, a dotted inner wall and a markup line, over two
// rooms that share a doored seam.
function everythingThatClamps() {
  const { project, map } = setup()

  const painting = tx(map)
  const left = paintCells(painting, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
  paintCells(painting, project, map, rect(2, 0, 2, 2), { areaId: WORLD_AREA_ID })
  drawInnerWall(painting, map, left.id, edgeKey(1, 0, 'V'), 'dotted')
  ok(
    createLine(painting, map, ['0,3', '1,3', '2,3'], {
      color: '#ff0000',
      arrowStart: false,
      arrowEnd: true,
    }),
  )
  painting.commit()

  const doorway = tx(map)
  const [door] = ok(createFromBox(doorway, project, map, '1,0', '2,0'))
  // A colourless lock (which Open permanently is) draws a clean gap and no
  // marker at all, so the marker's own weight would go unmeasured.
  setLock(doorway, project, map, door.id, 'both', LOCKED_LOCK_ID)
  setDirection(doorway, project, map, door.id, 'aToB')
  doorway.commit()

  return { project, map }
}

function draw(scene: MapScene, width: number, height: number) {
  const records = createRecordingContext()
  renderMap(records.ctx as unknown as CanvasRenderingContext2D, width, height, scene)
  return records
}

// Every grid line's span along one axis, in the drawn units, so an assertion
// can ask whether the outermost line reached the bitmap's edge.
function gridSpans(strokes: RecordedStroke[]) {
  const grid = strokes.find((stroke) => stroke.style === '#grid')
  if (!grid) throw new Error('no grid stroke recorded')
  const half = grid.width / 2
  return {
    left: Math.min(...grid.segments.filter(([x1, , x2]) => x1 === x2).map(([x]) => x - half)),
    right: Math.max(...grid.segments.filter(([x1, , x2]) => x1 === x2).map(([x]) => x + half)),
    top: Math.min(...grid.segments.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y - half)),
    bottom: Math.max(...grid.segments.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y + half)),
  }
}

describe('the export rectangle', () => {
  // The page unions a fixed home rectangle so the canvas has something to draw
  // when a map is empty. That floor is a display concern: applied here it would
  // export a two-cell map as 21x21 of mostly empty grid.
  it('never unions PAGE_HOME, so a small map exports at its own size', () => {
    const { map } = twoByTwo()
    const rectangle = exportRectangle(map, { margin: 2, layers: { lines: true } })!

    expect(rectangle).toEqual({ minCol: -2, minRow: -2, maxCol: 3, maxRow: 3 })
    expect(imageSize(rectangle, 32)).toEqual({ width: 192, height: 192 })
    expect(rectangle.minCol).toBeGreaterThan(PAGE_HOME.minCol)
  })

  // A map drawn far from the origin would otherwise export as a rectangle
  // spanning the void between it and the origin.
  it('stays with content far from the origin', () => {
    const { project, map } = setup()
    const painting = tx(map)
    paintCells(painting, project, map, rect(200, 200, 1, 1), { areaId: WORLD_AREA_ID })
    painting.commit()

    expect(exportRectangle(map, { margin: 1, layers: { lines: true } })).toEqual({
      minCol: 199,
      minRow: 199,
      maxCol: 201,
      maxRow: 201,
    })
  })

  describe('a layer that is off does not size it', () => {
    function roomAndFarLine() {
      const { project, map } = setup()
      const painting = tx(map)
      paintCells(painting, project, map, rect(0, 0, 2, 2), { areaId: WORLD_AREA_ID })
      ok(
        createLine(painting, map, ['40,0', '41,0'], {
          color: '#ff0000',
          arrowStart: false,
          arrowEnd: false,
        }),
      )
      painting.commit()
      return { project, map }
    }

    it('includes line points with the lines layer on', () => {
      const { map } = roomAndFarLine()
      expect(exportRectangle(map, { margin: 1, layers: { lines: true } })!.maxCol).toBe(42)
    })

    it('drops them with it off, so the picture is of the room', () => {
      const { map } = roomAndFarLine()
      expect(exportRectangle(map, { margin: 1, layers: { lines: false } })!.maxCol).toBe(2)
    })

    // The rectangle has two terms and not three, and this is the whole of why:
    // an icon cannot exist outside a room, so an icon term would union a subset.
    // Asserting only that a placed icon moves nothing would hold against a
    // renderer that could place one anywhere, since an icon inside a room never
    // moves anything. The refusal is what the two-term derivation rests on.
    it('cannot be enlarged by an icon, because an icon needs a room under it', () => {
      const { map } = twoByTwo()
      const before = exportRectangle(map, { margin: 2, layers: { lines: true } })

      const placing = tx(map)
      expect(placeIcon(placing, map, '40,40', 'save', TEST_ICON_COLORS)).toEqual(
        refuse('not-in-a-room'),
      )
      ok(placeIcon(placing, map, '1,1', 'save', TEST_ICON_COLORS))
      placing.commit()

      expect(exportRectangle(map, { margin: 2, layers: { lines: true } })).toEqual(before)
    })
  })

  // The margin arrives from a stored preference, which is hostile input. At 0
  // an outer wall stroked centred on the edge puts half of every boundary wall
  // off the bitmap.
  describe('the margin is clamped rather than trusted', () => {
    const rectangleAt = (margin: number) => {
      const { map } = twoByTwo()
      return exportRectangle(map, { margin, layers: { lines: true } })!
    }

    it('floors at 1, so no boundary wall is half off the bitmap', () => {
      expect(rectangleAt(0).minCol).toBe(0 - MARGIN_MIN)
      expect(rectangleAt(-5).minCol).toBe(0 - MARGIN_MIN)
    })

    it('ceilings at its top', () => {
      expect(rectangleAt(999).minCol).toBe(0 - MARGIN_MAX)
    })

    it('rounds, since a rectangle is measured in whole cells', () => {
      expect(rectangleAt(2.4)).toEqual(rectangleAt(2))
    })
  })

  it('is null when the visible layers draw nothing', () => {
    const { map } = setup()
    expect(exportRectangle(map, { margin: 2, layers: { lines: true } })).toBeNull()
  })
})

describe('the export scene', () => {
  // The whole of the size control. `renderMap` has no cell-size input, so a
  // preset has to be factorised into the pair it does take, and picking that
  // factorisation wrong reintroduces exactly what the control exists to avoid.
  describe('the drawn cell is the preset, and the project drops out', () => {
    it('fixes the tile size and derives the zoom', () => {
      const { project, map } = twoByTwo()
      const scene = buildExportScene(project, map.id, options({ pxPerCell: 128 }))!

      expect(scene.tileSize).toBe(EXPORT_TILE_SIZE)
      expect(scene.camera.zoom).toBe(4)
      expect(scene.tileSize * scene.camera.zoom).toBe(128)
    })

    it('draws the same picture at any project tile size', () => {
      const { project, map } = twoByTwo()
      const at20 = buildExportScene(project, map.id, options())!
      project.settings.tileSize = 48
      const at48 = buildExportScene(project, map.id, options())!

      expect(at48.tileSize).toBe(at20.tileSize)
      expect(at48.camera).toEqual(at20.camera)
    })

    it('puts the rectangle on the bitmap, corner to corner', () => {
      const { project, map } = twoByTwo()
      const scene = buildExportScene(project, map.id, options({ pxPerCell: 64 }))!
      const size = imageSize(scene.bounds, 64)
      const { fills } = draw(scene, size.width, size.height)

      // 6x6 cells at 64.
      expect(size).toEqual({ width: 384, height: 384 })
      expect(scene.camera.pan).toEqual({ x: scene.bounds.minCol, y: scene.bounds.minRow })
      expect(fills[0].rect).toEqual([0, 0, 384, 384])
    })

    // The whole premise of a size control: 32 and 128 must be one map at two
    // sizes, not two different-looking maps. At zoom 4 the door marker wants 20
    // against a ceiling of 12, the markup line wants 12 against 6, the
    // arrowhead wants 44 against 22 and the outer wall wants 8 against 6, so a
    // fixture without all four cannot see what the scaled ceiling buys. The
    // room-only fixture above draws grid and walls and nothing that clamps.
    it('scales ink with the cell, including every stroke that would clamp', () => {
      const { project, map } = everythingThatClamps()
      const small = buildExportScene(project, map.id, options({ pxPerCell: 32 }))!
      const large = buildExportScene(project, map.id, options({ pxPerCell: 128 }))!

      const widthsOf = (scene: MapScene) => {
        const size = imageSize(scene.bounds, scene.tileSize * scene.camera.zoom)
        return draw(scene, size.width, size.height).strokes.map((stroke) => stroke.width)
      }

      const at32 = widthsOf(small)
      // The four that clamp, plus the grid and the walls around them.
      expect(at32.length).toBeGreaterThan(4)
      expect(widthsOf(large)).toEqual(at32.map((width) => width * 4))
    })

    it('scales annotations by the same number', () => {
      const { project, map } = twoByTwo()

      expect(buildExportScene(project, map.id, options({ pxPerCell: 32 }))!.annotationScale).toBe(1)
      expect(buildExportScene(project, map.id, options({ pxPerCell: 96 }))!.annotationScale).toBe(3)
    })
  })

  // `bounds` means "the page" to every other consumer of a scene. Setting it to
  // the rectangle is what makes the page toggle a no-op here rather than a
  // missing control.
  describe('bounds is the rectangle, not the page', () => {
    it('draws grid to all four edges at a margin above PAGE_PADDING', () => {
      const { project, map } = twoByTwo()
      const margin = PAGE_PADDING + 3
      const scene = buildExportScene(project, map.id, options({ margin, pxPerCell: 32 }))!
      const size = imageSize(scene.bounds, 32)
      const { left, right, top, bottom } = gridSpans(draw(scene, size.width, size.height).strokes)

      expect(left).toBe(0)
      expect(top).toBe(0)
      expect(right).toBe(size.width)
      expect(bottom).toBe(size.height)
    })

    it('is the rectangle itself, so the page rule cannot enlarge it', () => {
      const { project, map } = twoByTwo()
      const scene = buildExportScene(project, map.id, options({ margin: 2 }))!

      expect(scene.bounds).toEqual(exportRectangle(map, { margin: 2, layers: ALL_LAYERS }))
    })

    // Both branches paint the same pixels once the rectangle fills the bitmap,
    // which is what says there is nothing for a page control to do here. The
    // shown branch lays the page down over the pasteboard and the hidden one
    // paints the page colour as the backdrop, so they differ by one redundant
    // full-canvas fill and by nothing else.
    it('paints the same pixels with the page shown', () => {
      const { project, map } = twoByTwo()
      const scene = buildExportScene(project, map.id, options())!
      const size = imageSize(scene.bounds, 32)
      const wholeBitmap = [0, 0, size.width, size.height]

      const hidden = draw(scene, size.width, size.height)
      const shown = draw({ ...scene, showPage: true }, size.width, size.height)

      const backdrops = (fills: typeof hidden.fills) =>
        fills.filter((fill) => fill.rect.join() === wholeBitmap.join())
      expect(backdrops(hidden.fills).map((fill) => fill.style)).toEqual(['#page'])
      expect(backdrops(shown.fills).map((fill) => fill.style)).toEqual(['#pasteboard', '#page'])

      expect(shown.strokes).toEqual(hidden.strokes)
      const overTheBackdrop = (fills: typeof hidden.fills) =>
        fills.filter((fill) => fill.rect.join() !== wholeBitmap.join())
      expect(overTheBackdrop(shown.fills)).toEqual(overTheBackdrop(hidden.fills))
    })
  })

  // Every trace of interaction, enforced against the field list. A probe that
  // selects a room and finds no halo passes green while a selected icon still
  // exports one, because `drawMarkupSelection` gates only on its own set.
  describe('it builds its own scene and never borrows the one on screen', () => {
    // Every interaction field at something a rest state is not, so a field the
    // builder forgot to blank is a field this fixture is still holding.
    function populated(room: Room): Pick<MapScene, (typeof INTERACTION_FIELDS)[number]> {
      return {
        ghost: { absorbing: new Set(['0,0']), becoming: new Set(['1,1']) },
        brushPreview: { col: 0, row: 0, size: 3 },
        boxPreview: { from: '0,0', to: '2,2', outcome: 'edge' },
        pendingTeleport: '0,0',
        selected: new Set(['tr_1' as TransitionId]),
        selectedRooms: new Set([room.id]),
        selectedCells: new Set<CellKey>(['0,0']),
        handleRoom: {
          room,
          band: 4,
          vertexRadius: 3,
          hovered: null,
          pointerCell: null,
          handles: { runs: true, vertices: true },
        },
        marquee: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        hoveredLabel: 'ic_1',
        selectedMarkup: new Set(['ic_1']),
      }
    }

    // Counted off the type, not off a list written here: a twelfth field lands
    // in the interaction half by default, and `EMPTY_INTERACTION` stops
    // compiling until somebody classifies it.
    it('carries eleven interaction fields', () => {
      const { room } = twoByTwo()
      expect(INTERACTION_FIELDS).toHaveLength(11)
      expect([...INTERACTION_FIELDS].sort()).toEqual([...Object.keys(populated(room))].sort())
    })

    it('leaves every one of them empty', () => {
      const { project, map, room } = twoByTwo()
      const scene = buildExportScene(project, map.id, options())!
      const dirty = populated(room)

      for (const field of INTERACTION_FIELDS) {
        const value = scene[field]
        const empty = value === null || (value instanceof Set && value.size === 0)
        expect(empty, `${field} is not empty`).toBe(true)
        expect(value, `${field} kept what the fixture put there`).not.toEqual(dirty[field])
      }
    })
  })

  describe('it takes the project and not the map', () => {
    // A cross-tab teleport is stored once under its origin map and the far end
    // is rebuilt from a project-scope index, so a builder handed one map alone
    // exports the marker as missing.
    it('reconstructs the far end of a cross-tab teleport', () => {
      const { project, map } = setup()
      const naming = tx()
      const caves = addMap(naming, project, 'Caves')
      naming.commit()

      const painting = tx(map)
      paintCells(painting, project, map, ['0,0'], { areaId: WORLD_AREA_ID })
      painting.commit()
      const below = tx(caves)
      paintCells(below, project, caves, ['0,0'], { areaId: WORLD_AREA_ID })
      below.commit()

      const linking = tx(map)
      ok(
        createTeleport(
          linking,
          project,
          { mapId: map.id, cell: '0,0' },
          { mapId: caves.id, cell: '0,0' },
        ),
      )
      linking.commit()

      const far = buildExportScene(project, caves.id, options())!
      expect(far.teleports.ends).toHaveLength(1)
    })

    it('hands over the areas, the lock types and the icon catalogue', () => {
      const { project, map } = twoByTwo()
      const scene = buildExportScene(project, map.id, options())!

      expect(scene.areas).toBe(project.areas)
      expect(scene.lockTypes).toBe(project.lockTypes)
      expect(scene.iconArt.size).toBeGreaterThan(0)
    })

    it('is null for a map id the project does not hold', () => {
      const { project } = twoByTwo()
      expect(buildExportScene(project, 'mp_nope' as MapId, options())).toBeNull()
    })
  })

  it('passes the layer flags through, and the resolved palette', () => {
    const { project, map } = twoByTwo()
    const layers: ExportLayers = {
      grid: false,
      transitions: true,
      teleportLines: false,
      icons: false,
      lines: true,
      allLabels: false,
    }
    const scene = buildExportScene(project, map.id, options({ layers }))!

    expect({
      grid: scene.showGrid,
      transitions: scene.showTransitions,
      teleportLines: scene.showTeleportLines,
      icons: scene.showIcons,
      lines: scene.showLines,
      allLabels: scene.showAllLabels,
    }).toEqual(layers)
    expect(scene.palette).toBe(palette)
  })

  // A file has no display, so a CSS pixel, a device pixel and an image pixel
  // are one thing and every rule stated in device pixels reads straight onto
  // the output.
  it('draws at device pixel ratio 1', () => {
    const { project, map } = twoByTwo()
    expect(buildExportScene(project, map.id, options())!.dpr).toBe(1)
  })

  it('is null when the visible layers draw nothing', () => {
    const { project } = setup()
    expect(buildExportScene(project, project.maps[0], options())).toBeNull()
  })
})

// The builder takes a rectangle and a cell size. There is no camera to hand it
// and no way for one to reach it, which is what makes "frames the map, never
// the window" structural rather than a thing to remember.
describe('the export frames the map, never the window', () => {
  it('answers the same scene however the tab is panned and zoomed', () => {
    const { project, map } = twoByTwo()
    const first = buildExportScene(project, map.id, options())!

    // Nothing here can move the export: the store the canvas pans is not an
    // input. Rebuilt after a project-level change to show it is stable.
    project.settings.tileSize = 96
    const second = buildExportScene(project, map.id, options())!

    expect(second.camera).toEqual(first.camera)
    expect(second.bounds).toEqual(first.bounds)
  })
})
