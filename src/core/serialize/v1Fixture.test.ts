// The frozen v1 file, never regenerated: the only artifact in the suite that
// outlives the code that produced it. Every other serializer test round-trips
// today's code against itself, which says nothing about whether it still
// agrees with what shipped.
//
// Its ids were rewritten to readable sequential ones (`room_01`, `map_02`)
// after generation. Real ids are 8 random base32 chars; nothing in the loader
// cares, and a hand-edited file is a supported input.
//
// When these tests fail, the format changed. Every field the format has gained
// since is declared in the round-trip test below, with the default the loader
// supplies. Whether it also bumped `FILE_VERSION` turns on whether it holds
// user data, not on whether it is additive: an added field owes a `STEPS` entry
// that stamps the version and changes nothing, and a replaced one owes a step
// that translates every project a user already saved. Do not regenerate the
// fixture; that deletes the evidence.

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
    // here and nowhere else, with the default the loader supplies, and so is
    // every field it has dropped. The list is the writer's whole licence to
    // differ from the file: anything not on it fails, which is the point.
    const expected = JSON.parse(JSON.stringify(fixture)) as JsonFile
    const icon = expected.project.maps[0].icons[0]
    icon.plateColor = '#e0e0e0'
    icon.glyphColor = '#202020'

    // A setting the format has since lost. Removing a field nothing reads does
    // not bump the version: the writer stops emitting it and the loader keeps
    // ignoring it, so this file still opens with nothing to repair and simply
    // saves back without it.
    delete (expected.project.settings as unknown as Record<string, unknown>).gridInExports

    // v2 replaced `oneWay: boolean` with `direction`, which is the one change
    // here that translates a value rather than defaulting an absent one: every
    // v1 one-way becomes `aToB` because v1 could only express a one-way in its
    // own A-to-B order. v3 added the two room fields, whose step stamps the
    // version and touches nothing, so they arrive here as defaults the writer
    // then states on every room.
    expected.version = 3
    for (const map of expected.project.maps) {
      for (const transition of map.transitions) {
        const legacy = transition as { oneWay?: boolean }
        transition.direction = legacy.oneWay ? 'aToB' : 'both'
        delete legacy.oneWay
      }
      for (const room of map.rooms) {
        room.heated = false
        room.liquidLevel = 0
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
