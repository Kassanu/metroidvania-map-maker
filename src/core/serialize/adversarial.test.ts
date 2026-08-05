// The hostile corpus, and the three things that must hold over every file in
// it. A `.mvm` arrives from whoever handed it to the user, so the loader's
// contract is not "reads good files" but "cannot be made to do something else
// by a bad one".
//
// Adding a hostile shape is adding a file to `fixtures/adversarial/`. The
// cases that are too large to check in are generated below instead, and go
// through exactly the same three assertions.

import { describe, expect, it } from 'vitest'
import { edgeRuns, interiorVertices, outerWalls } from '../derive/walls'
import { checkInvariants } from '../testUtils'
import { InvalidFileError, fromJSON, toJSON } from './index'
import { FileTooLargeError, LIMITS } from './limits'
import { UnsupportedVersionError } from './migrate'
import { FILE_FORMAT, FILE_VERSION } from './schema'
import type { JsonCell, JsonFile } from './schema'

// Every file in the directory, so a fixture that is added but never registered
// cannot sit there untested.
//
// Read as text and parsed here rather than imported as JSON: that is the path
// a real file takes, it lets a fixture be JSON that does not parse, and the
// build's own JSON loader refuses the deeply nested one anyway.
const files = import.meta.glob('./fixtures/adversarial/*.mvm.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

// Generous on purpose. It separates work proportional to a file's contents
// from work proportional to the space its coordinates span, which differ by
// nine orders of magnitude. It is not a performance measurement.
const TIME_BUDGET_MS = 5_000

// The errors the loader is allowed to raise. Anything else escaping it is a
// missed shape guard, and the difference between a dialog and a white screen.
function isExpectedError(error: unknown): boolean {
  return (
    error instanceof InvalidFileError ||
    error instanceof FileTooLargeError ||
    error instanceof UnsupportedVersionError
  )
}

// Cases too large to check in. Each is one of the count limits at the far side
// of its cap, built the way `limits.test.ts` builds them.
function generated(): { name: string; data: unknown }[] {
  const base = (maps: unknown[]): unknown => ({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    project: { name: 'Generated', settings: { tileSize: 32 }, lockTypes: [], areas: [], maps },
  })
  const map = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    name: 'M1',
    rooms: [],
    transitions: [],
    icons: [],
    lines: [],
    ...over,
  })
  const cells = (n: number): JsonCell[] => Array.from({ length: n }, (_, i): JsonCell => [i, 0])

  return [
    {
      name: 'rooms past the per-map cap',
      data: base([
        map({
          rooms: Array.from({ length: LIMITS.roomsPerMap + 1 }, (_, i) => ({
            id: `r${i}`,
            areaId: 'world',
            cells: [[i, 0]],
          })),
        }),
      ]),
    },
    {
      name: 'cells past the per-room cap',
      data: base([
        map({ rooms: [{ id: 'r1', areaId: 'world', cells: cells(LIMITS.cellsPerRoom + 1) }] }),
      ]),
    },
    {
      name: 'cells past the project cap, spread over rooms',
      data: (() => {
        const shared = cells(LIMITS.cellsPerRoom)
        const rooms = Math.ceil(LIMITS.cellsPerProject / LIMITS.cellsPerRoom) + 1
        return base([
          map({
            rooms: Array.from({ length: rooms }, (_, i) => ({
              id: `r${i}`,
              areaId: 'world',
              cells: shared,
            })),
          }),
        ])
      })(),
    },
    { name: 'maps past the cap', data: base(Array.from({ length: LIMITS.maps + 1 }, () => map())) },
    {
      name: 'text past every cap',
      data: base([
        map({
          rooms: [
            {
              id: 'r1',
              areaId: 'world',
              name: 'n'.repeat(LIMITS.nameLength * 4),
              notes: 'x'.repeat(LIMITS.notesLength * 2),
              cells: [[0, 0]],
            },
          ],
        }),
      ]),
    },
    // Not a file shape at all. `fromJSON` takes `unknown` and these are the
    // values a caller can actually hand it after a successful JSON.parse.
    { name: 'null', data: null },
    { name: 'a bare string', data: 'metroidvania-map-maker' },
    { name: 'a bare array', data: [] },
    { name: 'an empty object', data: {} },
    { name: 'a number', data: 7 },
    { name: 'the right format with no project', data: { format: FILE_FORMAT, version: 2 } },
    { name: 'a project that is an array', data: { format: FILE_FORMAT, version: 2, project: [] } },
    {
      name: 'a version that is not a number',
      data: { format: FILE_FORMAT, version: '2', project: {} },
    },
  ]
}

// A fixture that does not parse is a legitimate hostile shape, and its
// refusal belongs to `JSON.parse` rather than to the loader. It is carried
// through as a case so the corpus stays "one file, one shape".
const UNPARSEABLE = Symbol('unparseable')

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return UNPARSEABLE
  }
}

const cases: { name: string; data: unknown }[] = [
  ...Object.entries(files).map(([path, text]) => ({
    name: path.split('/').pop()!,
    data: parsed(text),
  })),
  ...generated(),
].filter((entry) => entry.data !== UNPARSEABLE)

const unparseable = Object.entries(files).filter(([, text]) => parsed(text) === UNPARSEABLE)

describe('the adversarial corpus', () => {
  it('is loaded from the directory rather than a list', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0)
  })

  for (const { name, data } of cases) {
    it(`${name}: refuses with a typed error, or loads a valid project`, () => {
      const started = performance.now()

      let project: ReturnType<typeof fromJSON>['project'] | null = null
      try {
        project = fromJSON(data).project
      } catch (error) {
        // The assertion is on the *kind*: an untyped throw means a guard was
        // missed, and the caller has nothing it can say to the user.
        if (!isExpectedError(error)) throw error
        expect(isExpectedError(error)).toBe(true)
      }

      expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS)

      // Everything downstream assumes the invariants hold. A file that loads
      // to a project that breaks one is worse than a file that is refused.
      if (project) expect(checkInvariants(project)).toEqual([])
    })
  }

  // Loading a file cheaply is only half of it: the renderer derives geometry
  // per room per frame, and a helper whose cost follows a room's bounding box
  // rather than its cells turns a file that loaded fine into a locked tab.
  // The precise regression for that lives beside the helper; this is what
  // makes every fixture in the corpus exercise the path at all.
  for (const { name, data } of cases) {
    it(`${name}: derives its geometry without stalling`, () => {
      let project: ReturnType<typeof fromJSON>['project']
      try {
        project = fromJSON(data).project
      } catch (error) {
        if (!isExpectedError(error)) throw error
        return
      }

      const started = performance.now()
      for (const mapId of project.maps) {
        for (const room of project.mapsById.get(mapId)!.rooms.values()) {
          outerWalls(room)
          edgeRuns(room)
          interiorVertices(room)
        }
      }
      expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS)
    })
  }

  // A repair that does not converge reports damage every time the file is
  // opened, and rewrites the user's data every time it is saved.
  for (const { name, data } of cases) {
    it(`${name}: repairs converge, so a second load has nothing left to do`, () => {
      let first: JsonFile
      try {
        first = toJSON(fromJSON(data).project)
      } catch (error) {
        if (!isExpectedError(error)) throw error
        return
      }

      const second = fromJSON(first)
      expect(second.report.events).toEqual([])
      expect(toJSON(second.project)).toEqual(first)
    })
  }

  it('leaves Object.prototype alone across the whole corpus', () => {
    const before = Object.keys(Object.prototype).length
    for (const { data } of cases) {
      try {
        fromJSON(data)
      } catch {
        // Refusing is a valid outcome; this asserts about the side effects.
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(Object.prototype).length).toBe(before)
  })

  // The hostile inputs that never reach `fromJSON`: they fail in `JSON.parse`,
  // so refusing them belongs to whoever read the bytes. Asserted here so the
  // corpus records that the shape was considered rather than missed.
  it('leaves unparseable files to the caller that read them', () => {
    expect(unparseable.length).toBeGreaterThan(0)
    for (const [path, text] of unparseable) {
      expect(() => JSON.parse(text), path).toThrow(SyntaxError)
    }
  })
})
