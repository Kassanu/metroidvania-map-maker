// The frozen v1 file, never regenerated: the only artifact in the suite that
// outlives the code that produced it. Every other serializer test round-trips
// today's code against itself, which says nothing about whether it still
// agrees with what shipped.
//
// Its ids were rewritten to readable sequential ones (`room_01`, `map_02`)
// after generation. Real ids are 8 random base32 chars; nothing in the loader
// cares, and a hand-edited file is a supported input.
//
// When this test fails, the format changed, and a `STEPS` entry in
// `migrate.ts` is owed for every project a user already saved. Do not
// regenerate the fixture; that deletes the evidence.

import { describe, expect, it } from 'vitest'
import { openProject, toJSON } from './index'
import { checkInvariants } from '../testUtils'
import { getFarEnd } from '../farEnds'
import { cellKey } from '../cell'
import fixture from './fixtures/v1-project.mvm.json'

describe('the frozen v1 file', () => {
  it('opens with nothing to repair', () => {
    const pending = openProject(fixture)

    // Every LoadEvent *is* a repair (decision D1), so an empty list is the
    // assertion: today's loader reads the file exactly as written, with no
    // field silently dropped, defaulted or reconstructed.
    expect(pending.report.events).toEqual([])
    expect(pending.requiresConfirmation).toBe(false)
    expect(checkInvariants(pending.accept())).toEqual([])
  })

  it('writes back byte-for-byte what it read', () => {
    // Load-then-save is the round trip that matters for a real user's file:
    // opening a project and saving it must not rewrite it. A field the loader
    // understands but the writer forgets (or vice versa) shows up here and
    // nowhere else, because the zero-events check above only sees the read.
    expect(toJSON(openProject(fixture).accept())).toEqual(fixture)
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
