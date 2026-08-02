import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginLineStroke } from './lineStroke'
import { mapScope, useModelStore } from '@/stores/model'
import { createLine, extendLine, normalizePath } from '@/core/ops/markup'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { checkInvariants } from '@/core/testUtils'
import type { LineId, MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

const STYLE = { color: '#d9a441', arrowStart: false, arrowEnd: false }

function setup() {
  setActivePinia(createTestPinia())
  const model = useModelStore()
  const mapId = model.project.maps[0]
  return { model, mapId }
}

function mapOf(mapId: MapId) {
  return useModelStore().project.mapsById.get(mapId)!
}

function linesOn(mapId: MapId) {
  return [...mapOf(mapId).lines.values()]
}

// A new-line drag, driven the way CanvasRegion drives it.
function drawFrom(mapId: MapId, origin: CellKey) {
  const map = mapOf(mapId)
  return beginLineStroke({
    mapId,
    origin,
    label: 'Draw Line',
    onChange: () => {},
    apply: (tx, points) => {
      createLine(tx, map, [...points], STYLE)
    },
  })
}

function extendFrom(mapId: MapId, id: LineId, atStart: boolean, anchor: CellKey) {
  const map = mapOf(mapId)
  return beginLineStroke({
    mapId,
    origin: anchor,
    label: 'Extend Line',
    onChange: () => {},
    apply: (tx, points) => {
      extendLine(tx, map, id, atStart, [...points].slice(1))
    },
  })
}

describe('the line drag', () => {
  beforeEach(() => {
    setup()
  })

  it('makes no line until the path leaves its first cell', () => {
    const { mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    // Wandering inside the origin cell adds nothing: a click makes no line, and
    // `createLine` refuses anything under two cells.
    stroke.extendTo({ x: 0.9, y: 0.2 })
    expect(stroke.points).toEqual(['0,0'])
    expect(linesOn(mapId)).toHaveLength(0)

    stroke.commit()
    expect(linesOn(mapId)).toHaveLength(0)
  })

  it('shows the line while the drag is live, then commits it', () => {
    const { mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    stroke.extendTo({ x: 2.5, y: 0.5 })
    // Speculatively applied, so mid-drag the model already is the result and
    // the renderer needs no preview of its own.
    expect(linesOn(mapId)).toHaveLength(1)
    expect(linesOn(mapId)[0].points).toEqual(['0,0', '1,0', '2,0'])

    stroke.commit()
    expect(linesOn(mapId)).toHaveLength(1)
  })

  it('interpolates a fast drag, so the line is as long as the path drawn', () => {
    const { mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    // One sample, nine cells away: the ordinary case at speed. Pushing raw
    // samples would hand `normalizePath` a jump, and it drops the whole rest of
    // the path rather than leaving a gap.
    stroke.extendTo({ x: 9.5, y: 5.5 })
    stroke.commit()

    const points = linesOn(mapId)[0].points
    expect(points[0]).toBe('0,0')
    expect(points.at(-1)).toBe('9,5')
    expect(points).toHaveLength(10)
    // Survives the model's own guard untouched, which is the actual assertion:
    // anything not 8-adjacent would have been silently truncated.
    expect(normalizePath(points)).toEqual(points)
  })

  it('keeps diagonals diagonal rather than stepping around them', () => {
    const { mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    stroke.extendTo({ x: 3.5, y: 3.5 })
    stroke.commit()

    expect(linesOn(mapId)[0].points).toEqual(['0,0', '1,1', '2,2', '3,3'])
  })

  it('appends the way back when the pointer doubles back', () => {
    const { mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    stroke.extendTo({ x: 2.5, y: 0.5 })
    stroke.extendTo({ x: 0.5, y: 0.5 })
    stroke.commit()

    // The locked rule is "each step adds a unit segment", so a path that comes
    // back over itself is longer, not shorter. This is where it differs from
    // the structured gestures, which reverse.
    expect(linesOn(mapId)[0].points).toEqual(['0,0', '1,0', '2,0', '1,0', '0,0'])
  })

  it('is one undo step for the whole drag', () => {
    const { model, mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    stroke.extendTo({ x: 2.5, y: 0.5 })
    stroke.extendTo({ x: 4.5, y: 2.5 })
    stroke.commit()
    expect(linesOn(mapId)).toHaveLength(1)

    model.undo()
    expect(linesOn(mapId)).toHaveLength(0)
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('leaves nothing behind when cancelled mid-drag', () => {
    const { model, mapId } = setup()
    const stroke = drawFrom(mapId, '0,0')

    stroke.extendTo({ x: 3.5, y: 0.5 })
    expect(linesOn(mapId)).toHaveLength(1)

    stroke.cancel()
    expect(linesOn(mapId)).toHaveLength(0)
    expect(model.status.undoLabel).toBeNull()
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('draws where no room is, because a line has no room owner', () => {
    const { model, mapId } = setup()
    // A room exists somewhere else entirely; the drag never touches it.
    model.run('Room', mapScope(mapId), (tx) =>
      paintCells(tx, model.project, mapOf(mapId), ['0,0'], { areaId: WORLD_AREA_ID }),
    )

    const stroke = drawFrom(mapId, '20,20')
    stroke.extendTo({ x: 23.5, y: 20.5 })
    stroke.commit()

    expect(linesOn(mapId)[0].points).toEqual(['20,20', '21,20', '22,20', '23,20'])
  })
})

describe('the extend drag', () => {
  function withLine(mapId: MapId) {
    const model = useModelStore()
    let id!: LineId
    model.run('Seed', mapScope(mapId), (tx) => {
      const line = createLine(tx, mapOf(mapId), ['2,0', '3,0'], STYLE)
      id = (line as { id: LineId }).id
    })
    return id
  }

  it('adds to the end it was started from', () => {
    const { mapId } = setup()
    const id = withLine(mapId)

    const stroke = extendFrom(mapId, id, false, '3,0')
    stroke.extendTo({ x: 5.5, y: 0.5 })
    stroke.commit()

    expect(mapOf(mapId).lines.get(id)!.points).toEqual(['2,0', '3,0', '4,0', '5,0'])
  })

  it('adds to the start in draw order, so the path stays continuous', () => {
    const { mapId } = setup()
    const id = withLine(mapId)

    const stroke = extendFrom(mapId, id, true, '2,0')
    stroke.extendTo({ x: 0.5, y: 0.5 })
    stroke.commit()

    // Prepended and reversed by the op, so reading the points still walks the
    // line from one end to the other.
    expect(mapOf(mapId).lines.get(id)!.points).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('extends one line rather than making a second', () => {
    const { mapId } = setup()
    const id = withLine(mapId)

    const stroke = extendFrom(mapId, id, false, '3,0')
    stroke.extendTo({ x: 6.5, y: 3.5 })
    stroke.commit()

    expect(linesOn(mapId)).toHaveLength(1)
    expect(mapOf(mapId).lines.get(id)!.points.length).toBeGreaterThan(2)
  })

  it('leaves the line as it was when cancelled', () => {
    const { mapId } = setup()
    const id = withLine(mapId)

    const stroke = extendFrom(mapId, id, false, '3,0')
    stroke.extendTo({ x: 6.5, y: 0.5 })
    expect(mapOf(mapId).lines.get(id)!.points.length).toBeGreaterThan(2)

    stroke.cancel()
    expect(mapOf(mapId).lines.get(id)!.points).toEqual(['2,0', '3,0'])
  })
})
