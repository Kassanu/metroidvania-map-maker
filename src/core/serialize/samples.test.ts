// The sample projects in `samples/`, which are real files a person opens
// through the File menu rather than anything the app loads by itself.
//
// They are checked in for two reasons: they are what a developer opens to see
// the renderer against real content, and switching between them is how the app
// is tested for state that outlives a project. A sample that stopped loading
// cleanly would be a format change nobody noticed, which is the same job the
// frozen v1 fixture does from the other end.
//
// Read as raw text and parsed here, so adding a sample is adding a file.

import { describe, expect, it } from 'vitest'
import { openProject, toJSON } from './index'
import { checkInvariants } from '../testUtils'

const files = import.meta.glob('/samples/*.mvm', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const samples = Object.entries(files).map(([path, text]) => ({
  name: path.split('/').pop()!,
  data: JSON.parse(text) as unknown,
}))

describe('the sample projects', () => {
  it('are all present', () => {
    expect(samples.length).toBeGreaterThanOrEqual(3)
  })

  for (const { name, data } of samples) {
    // An empty events list means the file says exactly what it means to say:
    // no cell, lock or endpoint quietly defaulted on the way in.
    it(`${name}: opens with nothing to repair`, () => {
      const pending = openProject(data)
      expect(pending.report.events).toEqual([])
      expect(pending.requiresConfirmation).toBe(false)
      expect(checkInvariants(pending.accept())).toEqual([])
    })

    it(`${name}: writes back exactly what it read`, () => {
      const project = openProject(data).accept()
      expect(toJSON(project)).toEqual(data)
    })
  }

  // The samples exist to be told apart on screen, so a leak between two loads
  // is visible rather than subtle. This is the property that makes that true.
  it('share no area or lock type ids between projects', () => {
    const seen = new Map<string, string>()
    for (const { name, data } of samples) {
      const project = openProject(data).accept()
      for (const id of [...project.areas.keys(), ...project.lockTypes.keys()]) {
        // World and Open are the guaranteed fallbacks and are meant to be
        // shared; everything else must be unique to its own file.
        if (id === 'world' || id === 'open' || id === 'locked') continue
        expect(seen.has(id), `${id} is in both ${seen.get(id)} and ${name}`).toBe(false)
        seen.set(id, name)
      }
    }
  })

  it('carry every transition kind the canvas has to draw, between them', () => {
    const kinds = new Set<string>()
    for (const { data } of samples) {
      const project = openProject(data).accept()
      for (const mapId of project.maps) {
        for (const transition of project.mapsById.get(mapId)!.transitions.values()) {
          kinds.add(transition.kind)
        }
      }
    }
    expect([...kinds].sort()).toEqual(['edge', 'elevator', 'teleport'])
  })
})
