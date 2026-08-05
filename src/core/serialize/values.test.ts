import { describe, it, expect } from 'vitest'
import { fromJSON } from './index'
import type { LoadEvent, LoadEventKind, LoadReport } from './index'
import { LIMITS } from './limits'
import { migrate } from './migrate'
import { FILE_FORMAT, FILE_VERSION } from './schema'
import type { JsonCell, JsonFile, JsonMap, JsonProject } from './schema'

function eventsOf<K extends LoadEventKind>(
  report: LoadReport,
  kind: K,
): Extract<LoadEvent, { kind: K }>[] {
  return report.events.filter((event): event is Extract<LoadEvent, { kind: K }> => {
    return event.kind === kind
  })
}

function mapOf(overrides: Partial<JsonMap> = {}): JsonMap {
  return {
    id: 'm1',
    name: 'Map 1',
    rooms: [{ id: 'r1', areaId: 'world', cells: [[0, 0] as JsonCell] }],
    transitions: [],
    icons: [],
    lines: [],
    ...overrides,
  }
}

function fileOf(overrides: Partial<JsonProject> = {}): JsonFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    project: {
      name: 'Project',
      settings: { tileSize: 32 },
      lockTypes: [],
      areas: [],
      maps: [mapOf()],
      ...overrides,
    },
  }
}

function v1WithOneWay(): JsonFile {
  return {
    format: FILE_FORMAT,
    version: 1,
    project: {
      name: 'Project',
      settings: { tileSize: 32 },
      lockTypes: [],
      areas: [],
      maps: [
        mapOf({
          transitions: [
            {
              id: 't1',
              type: 'elevator',
              locks: { a: 'open', b: 'open' },
              geometry: { a: [0, 0], b: [0, 1], axis: 'v' },
              // The v1 encoding, which the step replaces.
              oneWay: true,
            } as unknown as JsonMap['transitions'][number],
          ],
        }),
      ],
    },
  }
}

describe('migrate leaves its input alone', () => {
  it('yields the same result every time it is given the same object', () => {
    const file = v1WithOneWay()

    const first = migrate(file)
    const second = migrate(file)

    expect(first.project.maps[0].transitions[0].direction).toBe('aToB')
    expect(second.project.maps[0].transitions[0].direction).toBe('aToB')
  })

  it('does not write the migrated shape back onto the caller', () => {
    const file = v1WithOneWay()
    migrate(file)

    expect(file.version).toBe(1)
    const transition = file.project.maps[0].transitions[0] as unknown as { oneWay?: boolean }
    expect(transition.oneWay).toBe(true)
    expect(file.project.maps[0].transitions[0].direction).toBeUndefined()
  })

  it('hands a current file straight back, uncopied', () => {
    const file = fileOf()
    expect(migrate(file)).toBe(file)
  })
})

describe('colours are hex or they are nothing', () => {
  const accepted = ['#fff', '#ffff', '#ffccaa', '#ffccaa80', '#FFCCAA']
  const refused = [
    'url(https://example.invalid/beacon.png)',
    'var(--canvas-room-fill)',
    'red',
    'rgb(1,2,3)',
    '#ff',
    '#fffff',
    'image-set(url(x))',
    '#ffccaa; background-image: url(x)',
    42,
    {},
  ]

  for (const color of accepted) {
    it(`keeps ${color}`, () => {
      const file = fileOf({ areas: [{ id: 'a1', name: 'A', cellColor: color }] })
      const { project, report } = fromJSON(file)
      expect(project.areas.get('a1' as never)?.cellColor).toBe(color)
      expect(report.events).toHaveLength(0)
    })
  }

  for (const color of refused) {
    it(`refuses ${JSON.stringify(color)}`, () => {
      const file = fileOf({
        areas: [{ id: 'a1', name: 'A', cellColor: color as unknown as string }],
      })
      const { project, report } = fromJSON(file)
      expect(project.areas.get('a1' as never)?.cellColor).toBeNull()
      expect(eventsOf(report, 'color-reset')).toHaveLength(1)
    })
  }

  it('treats an absent colour as no colour, silently', () => {
    const { project, report } = fromJSON(fileOf({ areas: [{ id: 'a1', name: 'A' }] }))
    expect(project.areas.get('a1' as never)?.cellColor).toBeNull()
    expect(report.events).toHaveLength(0)
  })

  it('guards every colour a file can carry', () => {
    const bad = 'url(https://example.invalid/x.png)'
    const file = fileOf({
      settings: { tileSize: 32, backgroundColor: bad, gridColor: bad },
      areas: [{ id: 'a1', name: 'A', cellColor: bad, wallColor: bad }],
      lockTypes: [{ id: 'lk1', name: 'L', color: bad }],
      maps: [
        mapOf({
          icons: [
            {
              id: 'ic1',
              iconType: 'save',
              cell: [0, 0],
              plateColor: bad,
              glyphColor: bad,
            },
          ],
          lines: [
            {
              id: 'ln1',
              color: bad,
              points: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        }),
      ],
    })

    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!

    expect(project.settings.backgroundColor).toBeNull()
    expect(project.settings.gridColor).toBeNull()
    expect(project.areas.get('a1' as never)?.cellColor).toBeNull()
    expect(project.areas.get('a1' as never)?.wallColor).toBeNull()
    expect(project.lockTypes.get('lk1' as never)?.color).toBeNull()
    // The two that are never null: they fall back to a real colour instead.
    const icon = [...map.icons.values()][0]
    expect(icon.plateColor).toBe('#e0e0e0')
    expect(icon.glyphColor).toBe('#202020')
    expect([...map.lines.values()][0].color).toBe('#ffffff')

    // Six reported as colours, two as the settings they are.
    expect(eventsOf(report, 'color-reset')).toHaveLength(6)
    expect(eventsOf(report, 'setting-reset').map((e) => e.setting)).toEqual([
      'backgroundColor',
      'gridColor',
    ])
  })

  it('never lets a colour survive a round trip through the model', () => {
    const file = fileOf({ areas: [{ id: 'a1', name: 'A', cellColor: 'url(https://x.invalid)' }] })
    const { project } = fromJSON(file)
    expect(JSON.stringify(project.areas.get('a1' as never))).not.toContain('url(')
  })
})

describe('an icon type is a registry key', () => {
  it('keeps one that could name an entry', () => {
    const file = fileOf({
      maps: [mapOf({ icons: [{ id: 'ic1', iconType: 'save', cell: [0, 0] }] })],
    })
    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!
    expect([...map.icons.values()][0].iconType).toBe('save')
    expect(report.events).toHaveLength(0)
  })

  it('resets one that could not, and says so', () => {
    for (const iconType of ['<script>', 'A'.repeat(65), 'has space', 42]) {
      const file = fileOf({
        maps: [mapOf({ icons: [{ id: 'ic1', iconType: iconType as string, cell: [0, 0] }] })],
      })
      const { project, report } = fromJSON(file)
      const map = project.mapsById.get(project.maps[0])!
      expect([...map.icons.values()][0].iconType).toBe('unknown')
      expect(eventsOf(report, 'icon-type-reset')).toHaveLength(1)
    }
  })
})

describe('a lock type glyph is capped', () => {
  it('truncates one long enough to be a name', () => {
    const file = fileOf({
      lockTypes: [{ id: 'lk1', name: 'L', glyph: '!'.repeat(LIMITS.glyphLength + 1) }],
    })
    const { project, report } = fromJSON(file)
    expect(project.lockTypes.get('lk1' as never)?.glyph).toHaveLength(LIMITS.glyphLength)
    expect(eventsOf(report, 'text-truncated').map((e) => e.what)).toEqual(['lock type glyph'])
  })

  it('leaves an absent glyph absent', () => {
    const { project, report } = fromJSON(fileOf({ lockTypes: [{ id: 'lk1', name: 'L' }] }))
    expect(project.lockTypes.get('lk1' as never)?.glyph).toBeNull()
    expect(report.events).toHaveLength(0)
  })
})

// There is no known path today: the model is Map-keyed throughout and the one
// object-index write iterates a fixed list. This is what makes that stay true
// when someone later reaches for a merge over parsed data.
describe('a file cannot reach Object.prototype', () => {
  const payload = `{
    "format": "${FILE_FORMAT}",
    "version": ${FILE_VERSION},
    "project": {
      "__proto__": { "polluted": "yes" },
      "constructor": { "prototype": { "polluted": "yes" } },
      "name": "Project",
      "settings": { "tileSize": 32, "__proto__": { "polluted": "yes" } },
      "lockTypes": [{ "id": "lk1", "name": "L", "__proto__": { "polluted": "yes" } }],
      "areas": [{ "id": "a1", "name": "A", "__proto__": { "polluted": "yes" } }],
      "maps": [{
        "id": "m1", "name": "M", "transitions": [], "lines": [],
        "__proto__": { "polluted": "yes" },
        "rooms": [{ "id": "r1", "areaId": "a1", "cells": [[0, 0]], "__proto__": { "polluted": "yes" } }],
        "icons": [{ "id": "ic1", "iconType": "save", "cell": [0, 0], "__proto__": { "polluted": "yes" } }]
      }]
    }
  }`

  it('leaves the prototype untouched', () => {
    // Parsed rather than written as a literal: `__proto__` in an object
    // literal sets the prototype, where JSON.parse makes it an own property,
    // and the own property is the thing an unsafe merge would copy.
    const before = Object.keys(Object.prototype).length
    fromJSON(JSON.parse(payload))

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(Object.prototype).length).toBe(before)
  })

  it('loads the file rather than choking on it', () => {
    const { project } = fromJSON(JSON.parse(payload))
    expect(project.name).toBe('Project')
    expect(project.areas.has('a1' as never)).toBe(true)
    const map = project.mapsById.get(project.maps[0])!
    expect(map.rooms.size).toBe(1)
  })
})
