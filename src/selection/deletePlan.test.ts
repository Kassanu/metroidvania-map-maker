import { describe, it, expect } from 'vitest'
import { isEmptyPlan, planDelete, roomsMovingToWorld, touchesMap } from './deletePlan'
import { createNewArea } from '@/core/ops/project'
import { assignRoomArea, paintCells } from '@/core/ops/rooms'
import { setup, tx } from '@/core/testUtils'
import { WORLD_AREA_ID, type AreaId, type IconId, type LineId, type RoomId } from '@/core/ids'
import type { ObjectRef } from '@/core/types'

// What `Delete` would do to a selection, decided without a DOM. Both menus and
// the key read this, so the rules are pinned here once rather than at three
// call sites.

const ROOM = 'r1' as RoomId
const OTHER_ROOM = 'r2' as RoomId
const ICON = 'i1' as IconId
const LINE = 'l1' as LineId
const CRATERIA = 'a1' as AreaId

const OBJECTS: ObjectRef[] = [
  { kind: 'room', id: ROOM },
  { kind: 'icon', id: ICON },
  { kind: 'line', id: LINE },
]

describe('planDelete', () => {
  it('splits a selection by kind', () => {
    const plan = planDelete(OBJECTS, { erasesCells: false })
    expect(plan.rooms).toEqual([ROOM])
    expect(plan.icons).toEqual([ICON])
    expect(plan.lines).toEqual([LINE])
    expect(plan.cells).toEqual([])
  })

  // World is the area every room falls back to, so it has no delete behind it:
  // a menu item enabled for it would offer an action that refuses.
  it('drops World, and the plan for World alone is empty', () => {
    const plan = planDelete([{ kind: 'area', id: WORLD_AREA_ID }], { erasesCells: false })
    expect(plan.areas).toEqual([])
    expect(isEmptyPlan(plan)).toBe(true)
  })

  it('keeps every other area', () => {
    const plan = planDelete(
      [
        { kind: 'area', id: CRATERIA },
        { kind: 'area', id: WORLD_AREA_ID },
      ],
      { erasesCells: false },
    )
    expect(plan.areas).toEqual([CRATERIA])
    expect(isEmptyPlan(plan)).toBe(false)
  })

  it('drops cells where the key does not erase them', () => {
    const plan = planDelete([{ kind: 'cell', id: '0,0' }], { erasesCells: false })
    expect(plan.cells).toEqual([])
    expect(isEmptyPlan(plan)).toBe(true)
  })

  // Erasing is the whole of what the key means in that granularity. Running
  // both halves would delete objects the granularity cannot even select.
  it('holds nothing but cells where it erases them', () => {
    const plan = planDelete(
      [{ kind: 'cell', id: '0,0' }, { kind: 'area', id: CRATERIA }, ...OBJECTS],
      { erasesCells: true },
    )
    expect(plan.cells).toEqual(['0,0'])
    expect(plan.rooms).toEqual([])
    expect(plan.areas).toEqual([])
  })
})

describe('touchesMap', () => {
  // The scope decides where undo takes the user, and an area delete reassigns
  // rooms on tabs it was never pressed on.
  it('is false for areas alone and true as soon as map content joins them', () => {
    expect(touchesMap(planDelete([{ kind: 'area', id: CRATERIA }], { erasesCells: false }))).toBe(
      false,
    )
    expect(
      touchesMap(planDelete([{ kind: 'area', id: CRATERIA }, ...OBJECTS], { erasesCells: false })),
    ).toBe(true)
  })
})

describe('roomsMovingToWorld', () => {
  // Two rooms in one area, so the count has something to leave out.
  function twoInAnArea() {
    const { project, map } = setup()
    const transaction = tx(map)
    const area = createNewArea(transaction, project, 'Crateria', '#111111', '#222222')
    const first = paintCells(transaction, project, map, ['0,0'], { areaId: area.id })!
    const second = paintCells(transaction, project, map, ['5,5'], { areaId: area.id })!
    assignRoomArea(transaction, map, first.id, area.id)
    assignRoomArea(transaction, map, second.id, area.id)
    return { project, areaId: area.id, first: first.id }
  }

  it('counts every room in the areas being deleted', () => {
    const { project, areaId } = twoInAnArea()
    const plan = planDelete([{ kind: 'area', id: areaId }], { erasesCells: false })
    expect(roomsMovingToWorld(project, plan)).toBe(2)
  })

  // A room the same keypress deletes never arrives anywhere, so counting it as
  // moving would tell the user something that does not happen.
  it('leaves out the rooms the same plan deletes', () => {
    const { project, areaId, first } = twoInAnArea()
    const plan = planDelete(
      [
        { kind: 'area', id: areaId },
        { kind: 'room', id: first },
      ],
      { erasesCells: false },
    )
    expect(roomsMovingToWorld(project, plan)).toBe(1)
  })

  it('is zero with no area in the plan', () => {
    const { project } = twoInAnArea()
    expect(roomsMovingToWorld(project, planDelete(OBJECTS, { erasesCells: false }))).toBe(0)
  })
})

// A selection that names nothing this app can delete is the case both menus
// disable themselves on.
describe('isEmptyPlan', () => {
  it('is true for an empty selection', () => {
    expect(isEmptyPlan(planDelete([], { erasesCells: false }))).toBe(true)
  })

  it('is false once anything nameable is in it', () => {
    expect(isEmptyPlan(planDelete([{ kind: 'room', id: OTHER_ROOM }], { erasesCells: true }))).toBe(
      false,
    )
  })
})
