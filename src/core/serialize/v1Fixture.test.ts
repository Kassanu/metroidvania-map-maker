// The frozen v1 file, never regenerated: the only artifact in the suite that
// outlives the code that produced it. Every other serializer test round-trips
// today's code against itself, which says nothing about whether it still
// agrees with what shipped.
//
// Its ids were rewritten to readable sequential ones (`room_01`, `map_02`)
// after generation. Real ids are 8 random base32 chars; nothing in the loader
// cares, and a hand-edited file is a supported input.
//
// When these tests fail, the format changed. A field that is additive and
// optional, and that the loader defaults, is declared in the round-trip test
// below and owes no migration: bumping `FILE_VERSION` for one would make older
// builds reject a file they can read correctly. Anything else owes a `STEPS`
// entry in `migrate.ts` for every project a user already saved. Do not
// regenerate the fixture; that deletes the evidence.

import { describe, expect, it } from 'vitest'
import { openProject, toJSON } from './index'
import type { JsonFile } from './schema'
import { checkInvariants } from '../testUtils'
import { getFarEnd } from '../farEnds'
import { cellKey } from '../cell'
import fixture from './fixtures/v1-project.mvm.json'

describe('the frozen v1 file', () => {
  it('opens with nothing to repair', () => {
    const pending = openProject(fixture)

    // Every LoadEvent *is* a repair (decision D1), so an empty list is the
    // assertion: nothing in the file was dropped or reconstructed. An absent
    // optional field taking its documented default is not a repair, and the
    // round-trip test below is what pins which fields those are.
    expect(pending.report.events).toEqual([])
    expect(pending.requiresConfirmation).toBe(false)
    expect(checkInvariants(pending.accept())).toEqual([])
  })

  it('writes back what it read, plus only the fields the format has gained', () => {
    // Load-then-save is the round trip that matters for a real user's file:
    // opening a project and saving it must not rewrite it. A field the loader
    // understands but the writer forgets (or vice versa) shows up here and
    // nowhere else, because the zero-events check above only sees the read.
    //
    // Every field the format has gained since the fixture was frozen is listed
    // here and nowhere else, with the default the loader supplies. The list is
    // the writer's whole licence to differ from the file: anything not on it
    // fails, which is the point.
    const expected = JSON.parse(JSON.stringify(fixture)) as JsonFile
    const icon = expected.project.maps[0].icons[0]
    icon.plateColor = '#e0e0e0'
    icon.glyphColor = '#202020'

    // v2 replaced `oneWay: boolean` with `direction`, which is the one change
    // here that is a migration rather than a defaulted addition: the writer
    // stamps the new version, and every v1 one-way becomes `aToB` because v1
    // could only express a one-way in its own A-to-B order.
    expected.version = 2
    for (const map of expected.project.maps) {
      for (const transition of map.transitions) {
        const legacy = transition as { oneWay?: boolean }
        transition.direction = legacy.oneWay ? 'aToB' : 'both'
        delete legacy.oneWay
      }
    }

    expect(toJSON(openProject(fixture).accept())).toEqual(expected)
  })

  it('still resolves the cross-map teleport from the destination map', () => {
    const project = openProject(fixture).accept()
    const [surface, caves] = project.maps.map((id) => project.mapsById.get(id)!)

    // Stored once, under its origin; Caves holds no transition of its own.
    expect(surface.transitions.size).toBe(2)
    expect(caves.transitions.size).toBe(0)

    // ...and the destination tab's marker comes back off the far-end index,
    // rebuilt at load time rather than persisted. This is the reconciliation
    // that a format change would break most quietly.
    const farEnd = getFarEnd(project.teleportFarEnds, caves.id, cellKey(1, 1))
    expect(farEnd).toBeDefined()
    expect(farEnd!.originMapId).toBe(surface.id)
    expect(surface.transitions.has(farEnd!.transitionId)).toBe(true)
  })
})
