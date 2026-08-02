// The dev seed's project file. This one is content, so what needs guarding
// is different: the same load-clean check the frozen file gets, plus a census
// of the things the renderer is built against.

import { describe, expect, it } from 'vitest'
import { openProject } from '@/core/serialize'
import { checkInvariants } from '@/core/testUtils'
import fixture from './fixtures/dev-project.mvm.json'
import type { TransitionKind } from '@/core/types'

describe('the dev fixture', () => {
  it('opens with nothing to repair', () => {
    const pending = openProject(fixture)

    // An empty events list means the file says exactly what it means to say: no
    // cell, lock or endpoint quietly defaulted on the way in.
    expect(pending.report.events).toEqual([])
    expect(pending.requiresConfirmation).toBe(false)
    expect(checkInvariants(pending.accept())).toEqual([])
  })

  // One of everything the renderer can draw. This verifies that a transition
  // that fails to load shows up as a missing entry, which `checkInvariants`
  // cannot detect.
  it('carries every transition kind the canvas has to draw', () => {
    const project = openProject(fixture).accept()
    const [surface, caves] = project.maps.map((id) => project.mapsById.get(id)!)

    const kinds = new Map<TransitionKind, number>()
    for (const transition of surface.transitions.values()) {
      kinds.set(transition.kind, (kinds.get(transition.kind) ?? 0) + 1)
    }

    // Three doors: the 2-wide one, and two single-segment ones sharing a seam.
    // This tells a 2-wide door apart from two 1-wide neighbours.
    expect(kinds.get('edge')).toBe(3)
    // Both axes, because the shaft geometry differs per axis.
    expect(kinds.get('elevator')).toBe(2)
    // One within Surface (so there is a line to draw) and one to Caves (so there
    // is a far marker to draw, on a tab that stores no transition of its own).
    expect(kinds.get('teleport')).toBe(2)
    expect(caves.transitions.size).toBe(0)
    expect(project.teleportFarEnds.get(caves.id)?.size).toBe(1)

    // A one-way of every kind that can show an arrow, and a colourless door, so
    // the two-way and no-colour paths are on screen next to their opposites.
    const oneWay = [...surface.transitions.values()].filter((each) => each.oneWay)
    expect(oneWay.map((each) => each.kind).sort()).toEqual(['edge', 'elevator'])
  })

  // The markup layer's half of the census. Both carry a label, because a label
  // is something the renderer draws and nothing in the app can write one yet:
  // without them the dev build has no way to see that layer at all.
  it('carries a labelled icon and a labelled line', () => {
    const project = openProject(fixture).accept()
    const surface = project.mapsById.get(project.maps[0])!

    expect([...surface.icons.values()].map((icon) => icon.label)).toEqual(['Save Point'])
    expect([...surface.lines.values()].map((line) => line.label)).toEqual(['Long Way Round'])
  })
})
