// Transition kind x whether the far end is inside the export scope.
//
// One describe per kind, one it per column, so an uncovered cell shows up as a
// missing test. Every cell asserts the same thing, which is the table's point:
// denormalization does the work, so a partial export needs no special handling
// anywhere. The only difference between the columns is whether a reader can
// resolve the room and tab it is handed.

import { describe, expect, it } from 'vitest'
import type { MapId, RoomId } from '../ids'
import { createFromBox, createTeleport } from '../ops/doors'
import { addMap } from '../ops/maps'
import { makeRoom, ok, rect, setup, tx } from '../testUtils'
import { toCombinedExport } from './index'
import type { ExportScope } from './index'
import type { ExportRoom } from './schema'

interface Case {
  project: ReturnType<typeof setup>['project']
  near: RoomId
  nearMap: MapId
  far: RoomId
  farMap: MapId
}

function edgeDoor(): Case {
  const { project, map } = setup()
  const near = makeRoom(project, map, rect(0, 0, 2, 2))
  const far = makeRoom(project, map, rect(2, 0, 2, 2))
  const building = tx(map)
  ok(createFromBox(building, project, map, '1,0', '2,0'))
  building.commit()
  return { project, near: near.id, nearMap: map.id, far: far.id, farMap: map.id }
}

function elevator(): Case {
  const { project, map } = setup()
  const near = makeRoom(project, map, rect(0, 0, 1, 1))
  const far = makeRoom(project, map, rect(0, 3, 1, 1))
  const building = tx(map)
  ok(createFromBox(building, project, map, '0,0', '0,3'))
  building.commit()
  return { project, near: near.id, nearMap: map.id, far: far.id, farMap: map.id }
}

function teleportSameTab(): Case {
  const { project, map } = setup()
  const near = makeRoom(project, map, rect(0, 0, 1, 1))
  const far = makeRoom(project, map, rect(5, 0, 1, 1))
  const linking = tx(map)
  ok(
    createTeleport(
      linking,
      project,
      { mapId: map.id, cell: '0,0' },
      { mapId: map.id, cell: '5,0' },
    ),
  )
  linking.commit()
  return { project, near: near.id, nearMap: map.id, far: far.id, farMap: map.id }
}

function teleportCrossTab(): Case {
  const { project, map } = setup()
  const near = makeRoom(project, map, rect(0, 0, 1, 1))
  const adding = tx()
  const other = addMap(adding, project, 'Map 2')
  adding.commit()
  const far = makeRoom(project, other, rect(9, 9, 1, 1))
  const linking = tx(map)
  ok(
    createTeleport(
      linking,
      project,
      { mapId: map.id, cell: '0,0' },
      { mapId: other.id, cell: '9,9' },
    ),
  )
  linking.commit()
  return { project, near: near.id, nearMap: map.id, far: far.id, farMap: other.id }
}

function roomIn(tabs: { rooms: ExportRoom[] }[], id: RoomId): ExportRoom {
  for (const tab of tabs) {
    const found = tab.rooms.find((room) => room.id === id)
    if (found) return found
  }
  throw new Error(`no exported room ${id}`)
}

// The near room's transitions under a scope, against the same room's
// transitions under no scope at all.
function unchangedUnderScope(subject: Case, scope: ExportScope): void {
  const whole = toCombinedExport(subject.project)
  const partial = toCombinedExport(subject.project, scope)

  const before = roomIn(whole.tabs, subject.near).transitions
  const after = roomIn(partial.tabs, subject.near).transitions

  expect(after).toHaveLength(1)
  expect(after[0].from.room).toBe(subject.near)
  expect(after[0].to.room).toBe(subject.far)
  expect(after[0].to.tab).toBe(subject.farMap)
  expect(JSON.stringify(after)).toBe(JSON.stringify(before))
}

function withFarEnd(subject: Case): ExportScope {
  if (subject.nearMap === subject.farMap) {
    return new Map([[subject.nearMap, new Set([subject.near, subject.far])]])
  }
  return new Map([
    [subject.nearMap, new Set([subject.near])],
    [subject.farMap, new Set([subject.far])],
  ])
}

function withoutFarEnd(subject: Case): ExportScope {
  return new Map([[subject.nearMap, new Set([subject.near])]])
}

const KINDS: [string, () => Case][] = [
  ['an edge door', edgeDoor],
  ['an elevator', elevator],
  ['a teleport on one tab', teleportSameTab],
  ['a teleport across tabs', teleportCrossTab],
]

for (const [name, build] of KINDS) {
  describe(name, () => {
    it('is emitted in full from this room when the far end is in scope', () => {
      const subject = build()
      unchangedUnderScope(subject, withFarEnd(subject))
    })

    it('is emitted in full from this room when the far end is out of scope', () => {
      const subject = build()
      const scope = withoutFarEnd(subject)
      unchangedUnderScope(subject, scope)

      // The reference is left dangling rather than omitted or rewritten.
      const tabs = toCombinedExport(subject.project, scope).tabs
      expect(tabs.flatMap((tab) => tab.rooms.map((room) => room.id))).not.toContain(subject.far)
    })
  })
}
