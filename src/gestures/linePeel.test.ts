import { describe, it, expect } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { beginLinePeel } from './linePeel'
import { mapScope, useModelStore } from '@/stores/model'
import { createLine, peelLine } from '@/core/ops/markup'
import { checkInvariants, ok } from '@/core/testUtils'
import type { LineId, MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'
import type { WorldPoint } from '@/canvas/stroke'

const LINE_DEFAULTS = { color: '#ffcc00', arrowStart: false, arrowEnd: false }

// A straight five-point line, which is four segments: long enough that peeling
// can stop well short of the delete threshold.
function setup(points: CellKey[] = ['0,0', '1,0', '2,0', '3,0', '4,0']) {
  setActivePinia(createTestPinia())
  const model = useModelStore()
  const mapId = model.project.maps[0]
  let line!: LineId

  model.run('Setup', mapScope(mapId), (tx) => {
    line = ok(createLine(tx, model.project.mapsById.get(mapId)!, points, LINE_DEFAULTS)).id
  })
  return { model, mapId, line }
}

function mapOf(mapId: MapId) {
  return useModelStore().project.mapsById.get(mapId)!
}

function pointsOf(mapId: MapId, line: LineId): readonly CellKey[] | undefined {
  return mapOf(mapId).lines.get(line)?.points
}

function peelOf(mapId: MapId, line: LineId, atStart: boolean) {
  const map = mapOf(mapId)
  return beginLinePeel({
    mapId,
    points: map.lines.get(line)!.points,
    atStart,
    label: 'Erase Line',
    onChange: () => {},
    apply: (tx, count) => {
      peelLine(tx, map, line, atStart, count)
    },
  })
}

// The centre of a cell, which is where the count measures from.
function centre(x: number, y: number): WorldPoint {
  return { x: x + 0.5, y: y + 0.5 }
}

describe('the line peel', () => {
  it('takes segments off the grabbed end as the pointer moves inward', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(3, 0))
    expect(peel.count).toBe(1)
    // Speculatively applied, so the map already shows the pending result.
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0'])

    peel.moveTo(centre(2, 0))
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0'])

    peel.commit()
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0'])
  })

  it('peels from the start when that is the end that was grabbed', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, true)

    peel.moveTo(centre(2, 0))
    peel.commit()
    expect(pointsOf(mapId, line)).toEqual(['2,0', '3,0', '4,0'])
  })

  it('puts segments back when the pointer goes back outward', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(1, 0))
    expect(peel.count).toBe(3)

    // The count is derived and replaced, never accumulated: backing out is not
    // a second peel in the other direction, it is a smaller peel.
    peel.moveTo(centre(3, 0))
    expect(peel.count).toBe(1)
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('leaves no undo step when the pointer comes all the way back', () => {
    const { model, mapId, line } = setup()
    const before = model.status.undoLabel
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(1, 0))
    peel.moveTo(centre(4, 0))
    peel.commit()

    expect(peel.count).toBe(0)
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0'])
    expect(model.status.undoLabel).toBe(before)
  })

  it('writes nothing at all for a press that never moves', () => {
    const { model, mapId, line } = setup()
    const before = model.status.undoLabel

    peelOf(mapId, line, false).commit()

    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0'])
    expect(model.status.undoLabel).toBe(before)
  })

  it('deletes the line once peeling would leave under one segment', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    // The far end: four of the five points, leaving one, which is no line.
    peel.moveTo(centre(0, 0))
    expect(peel.count).toBe(4)
    // The ghost shows the deletion before release rather than at it.
    expect(mapOf(mapId).lines.has(line)).toBe(false)

    peel.commit()
    expect(mapOf(mapId).lines.has(line)).toBe(false)
  })

  it('brings a line deleted mid-drag back when the pointer returns', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(0, 0))
    expect(mapOf(mapId).lines.has(line)).toBe(false)

    // Every re-apply runs against the pristine model, so the line was never
    // deleted rather than deleted and rebuilt: the same id comes back.
    peel.moveTo(centre(3, 0))
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('follows the pointer around a bend rather than down one axis', () => {
    const { mapId, line } = setup(['0,0', '1,0', '2,0', '2,1', '2,2'])
    const peel = peelOf(mapId, line, false)

    // On the far arm of the bend. Projecting onto the grabbed end's own axis
    // would answer 2 here, off by the whole corner; the nearest point is 3.
    peel.moveTo(centre(1, 0))
    expect(peel.count).toBe(3)
    peel.commit()
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0'])
  })

  it('peels the fewer of two equally near points', () => {
    const { mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    // Exactly between the last two points.
    peel.moveTo({ x: 4, y: 0.5 })
    expect(peel.count).toBe(0)
  })

  it('ignores a pointer that moves without changing the count', () => {
    const { mapId, line } = setup()
    const map = mapOf(mapId)
    let repaints = 0
    const peel = beginLinePeel({
      mapId,
      points: map.lines.get(line)!.points,
      atStart: false,
      label: 'Erase Line',
      onChange: () => {
        repaints++
      },
      apply: (tx, count) => {
        peelLine(tx, map, line, false, count)
      },
    })

    peel.moveTo(centre(3, 0))
    expect(repaints).toBe(1)
    // Well off the line, but still nearest the same point.
    peel.moveTo({ x: 3.4, y: 2.2 })
    expect(repaints).toBe(1)
  })

  it('is one undo step for the whole drag', () => {
    const { model, mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(3, 0))
    peel.moveTo(centre(2, 0))
    peel.moveTo(centre(1, 0))
    peel.commit()

    model.undo()
    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0'])
    expect(checkInvariants(model.project)).toEqual([])
  })

  it('restores the line when cancelled mid-drag', () => {
    const { model, mapId, line } = setup()
    const peel = peelOf(mapId, line, false)

    peel.moveTo(centre(1, 0))
    peel.cancel()

    expect(pointsOf(mapId, line)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0'])
    expect(checkInvariants(model.project)).toEqual([])
  })
})
