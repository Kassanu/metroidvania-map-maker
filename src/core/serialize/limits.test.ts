import { describe, it, expect } from 'vitest'
import { fromJSON } from './index'
import type { LoadEvent, LoadEventKind, LoadReport } from './index'
import { CellBudget, FileTooLargeError, LIMITS, checkByteLength, checkLimit } from './limits'
import { FILE_FORMAT, FILE_VERSION } from './schema'
import type { JsonCell, JsonFile, JsonInnerWall, JsonMap, JsonProject } from './schema'

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
    rooms: [],
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

// A horizontal run, so the cells form one connected room and the load is not
// also exercising the split rule.
function run(length: number): JsonCell[] {
  return Array.from({ length }, (_, i): JsonCell => [i, 0])
}

// Every count limit, with the file that sits exactly on it and the file that
// steps one past. The shared arrays are deliberate: the loader budgets on
// `length` before it walks, so reusing one array keeps a cap-sized fixture
// from costing cap-sized memory.
describe('count limits reject rather than repair', () => {
  const cases: {
    limit: keyof typeof LIMITS
    at: (n: number) => JsonFile
  }[] = [
    { limit: 'maps', at: (n) => fileOf({ maps: Array.from({ length: n }, () => mapOf()) }) },
    {
      limit: 'areas',
      at: (n) =>
        fileOf({ areas: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: 'A' })) }),
    },
    {
      limit: 'lockTypes',
      at: (n) =>
        fileOf({ lockTypes: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, name: 'L' })) }),
    },
    {
      limit: 'roomsPerMap',
      at: (n) =>
        fileOf({
          maps: [
            mapOf({
              rooms: Array.from({ length: n }, (_, i) => ({
                id: `r${i}`,
                areaId: 'world',
                cells: [[i, 0] as JsonCell],
              })),
            }),
          ],
        }),
    },
    {
      limit: 'cellsPerRoom',
      at: (n) =>
        fileOf({ maps: [mapOf({ rooms: [{ id: 'r', areaId: 'world', cells: run(n) }] })] }),
    },
    {
      limit: 'innerWallsPerRoom',
      at: (n) => {
        const seg: JsonInnerWall = {
          seg: [
            [0, 0],
            [0, 1],
          ],
          style: 'solid',
        }
        return fileOf({
          maps: [
            mapOf({
              rooms: [
                {
                  id: 'r',
                  areaId: 'world',
                  cells: run(2),
                  innerWalls: Array.from({ length: n }, () => seg),
                },
              ],
            }),
          ],
        })
      },
    },
    {
      limit: 'iconsPerMap',
      at: (n) =>
        fileOf({
          maps: [
            mapOf({
              icons: Array.from({ length: n }, (_, i) => ({
                id: `i${i}`,
                iconType: 'save',
                cell: [0, 0] as JsonCell,
              })),
            }),
          ],
        }),
    },
    {
      limit: 'linesPerMap',
      at: (n) => {
        const points = run(2)
        return fileOf({
          maps: [
            mapOf({
              lines: Array.from({ length: n }, (_, i) => ({ id: `ln${i}`, color: '#fff', points })),
            }),
          ],
        })
      },
    },
    {
      limit: 'pointsPerLine',
      at: (n) =>
        fileOf({ maps: [mapOf({ lines: [{ id: 'ln', color: '#fff', points: run(n) }] })] }),
    },
    {
      limit: 'transitionsPerMap',
      at: (n) =>
        fileOf({
          maps: [
            mapOf({
              transitions: Array.from({ length: n }, (_, i) => ({
                id: `t${i}`,
                type: 'elevator' as const,
                locks: { a: 'open', b: 'open' },
                geometry: { a: [0, 0] as JsonCell, b: [0, 1] as JsonCell, axis: 'v' as const },
              })),
            }),
          ],
        }),
    },
    {
      limit: 'segmentsPerDoor',
      at: (n) =>
        fileOf({
          maps: [
            mapOf({
              transitions: [
                {
                  id: 't',
                  type: 'edge',
                  locks: { a: 'open', b: 'open' },
                  geometry: {
                    segments: Array.from({ length: n }, (_, i) => ({
                      cell: [i, 0] as JsonCell,
                      side: 'N' as const,
                    })),
                  },
                },
              ],
            }),
          ],
        }),
    },
  ]

  for (const { limit, at } of cases) {
    it(`accepts ${limit} exactly at its cap`, () => {
      expect(() => fromJSON(at(LIMITS[limit]))).not.toThrow()
    })

    it(`refuses ${limit} one past its cap`, () => {
      let thrown: unknown
      try {
        fromJSON(at(LIMITS[limit] + 1))
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(FileTooLargeError)
      expect((thrown as FileTooLargeError).limit).toBe(limit)
      expect((thrown as FileTooLargeError).found).toBe(LIMITS[limit] + 1)
      expect((thrown as FileTooLargeError).allowed).toBe(LIMITS[limit])
    })
  }
})

describe('the project-wide cell budget', () => {
  it('spends up to the cap and refuses the cell past it', () => {
    const budget = new CellBudget()
    expect(() => budget.spend(LIMITS.cellsPerProject)).not.toThrow()
    expect(() => budget.spend(1)).toThrow(FileTooLargeError)
  })

  it('accumulates across rooms rather than measuring each alone', () => {
    const budget = new CellBudget()
    const half = LIMITS.cellsPerProject / 2
    budget.spend(half)
    budget.spend(half)
    expect(() => budget.spend(1)).toThrow(FileTooLargeError)
  })

  it('is spent by the loader, once per room', () => {
    // Rooms sized so the total crosses the project cap while no single room
    // reaches its own. The same cell array in every room: the budget reads its
    // length, and the overlap rule drops the repeats.
    const cells = run(LIMITS.cellsPerRoom)
    const rooms = Math.ceil(LIMITS.cellsPerProject / LIMITS.cellsPerRoom) + 1
    const file = fileOf({
      maps: [
        mapOf({
          rooms: Array.from({ length: rooms }, (_, i) => ({
            id: `r${i}`,
            areaId: 'world',
            cells,
          })),
        }),
      ],
    })
    expect(() => fromJSON(file)).toThrow(FileTooLargeError)
  })
})

describe('the byte cap', () => {
  it('is what a provider checks before reading', () => {
    expect(() => checkByteLength(LIMITS.bytes)).not.toThrow()
    expect(() => checkByteLength(LIMITS.bytes + 1)).toThrow(FileTooLargeError)
  })

  it('names itself in the error', () => {
    try {
      checkByteLength(LIMITS.bytes + 1)
      expect.unreachable()
    } catch (error) {
      expect((error as FileTooLargeError).limit).toBe('bytes')
    }
  })
})

describe('checkLimit', () => {
  it('passes on the cap and fails one past it', () => {
    expect(() => checkLimit('maps', LIMITS.maps)).not.toThrow()
    expect(() => checkLimit('maps', LIMITS.maps + 1)).toThrow(FileTooLargeError)
  })
})

// The other half of the rule: a value out of range is one bad datum, so it
// goes through the repair channel and the file still loads.
describe('values repair rather than reject', () => {
  it('drops a cell outside the coordinate range and keeps the file', () => {
    const file = fileOf({
      maps: [
        mapOf({
          rooms: [
            {
              id: 'r',
              areaId: 'world',
              cells: [
                [0, 0],
                [LIMITS.coordinate + 1, 0],
                [0, -LIMITS.coordinate - 1],
              ],
            },
          ],
        }),
      ],
    })
    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!
    expect([...map.rooms.values()][0].cells.size).toBe(1)
    expect(eventsOf(report, 'cell-dropped')).toHaveLength(2)
    expect(eventsOf(report, 'cell-dropped').every((e) => e.reason === 'malformed')).toBe(true)
  })

  it('keeps a cell exactly on the coordinate range', () => {
    const file = fileOf({
      maps: [
        mapOf({
          rooms: [{ id: 'r', areaId: 'world', cells: [[LIMITS.coordinate, -LIMITS.coordinate]] }],
        }),
      ],
    })
    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!
    expect([...map.rooms.values()][0].cells.size).toBe(1)
    expect(report.events).toHaveLength(0)
  })

  it('truncates over-long text and says which field', () => {
    const file = fileOf({
      name: 'p'.repeat(LIMITS.nameLength + 1),
      maps: [
        mapOf({
          rooms: [
            {
              id: 'r',
              areaId: 'world',
              name: 'r'.repeat(LIMITS.nameLength + 1),
              notes: 'n'.repeat(LIMITS.notesLength + 1),
              cells: [[0, 0]],
            },
          ],
        }),
      ],
    })
    const { project, report } = fromJSON(file)
    const map = project.mapsById.get(project.maps[0])!
    const room = [...map.rooms.values()][0]

    expect(project.name).toHaveLength(LIMITS.nameLength)
    expect(room.name).toHaveLength(LIMITS.nameLength)
    expect(room.notes).toHaveLength(LIMITS.notesLength)
    expect(eventsOf(report, 'text-truncated').map((e) => e.what)).toEqual([
      'project name',
      'room name',
      'room notes',
    ])
  })

  it('leaves text exactly on its cap alone', () => {
    const file = fileOf({
      maps: [
        mapOf({
          rooms: [
            {
              id: 'r',
              areaId: 'world',
              name: 'r'.repeat(LIMITS.nameLength),
              cells: [[0, 0]],
            },
          ],
        }),
      ],
    })
    expect(fromJSON(file).report.events).toHaveLength(0)
  })
})
