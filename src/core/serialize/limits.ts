// The caps a file must satisfy to be loaded at all.
//
// A tier above the repair channel, not part of it. Trimming a file at ten
// thousand rooms produces a different project rather than a repaired one, and
// the trimming is itself the work being guarded against.
//
// Counts reject, values repair. A count over its cap means the file is not
// what it claims to be; a single out-of-range coordinate or over-long string
// is one bad datum, which is what the repair channel already exists for.

export const LIMITS = {
  // Bytes of JSON, checked against a file's size before it is read. A project
  // at every other cap in this table serialises to roughly 30 MB.
  bytes: 64 * 1024 * 1024,

  maps: 200,
  areas: 500,
  lockTypes: 200,

  roomsPerMap: 10_000,
  cellsPerRoom: 20_000,
  // The one cap here about the machine rather than about what a map plausibly
  // is: every cell is an entry in its room's set and another in the map's
  // owner index, so this bounds the model's resident size.
  cellsPerProject: 1_000_000,
  // Four edges per cell is the most a room can have strictly inside it.
  innerWallsPerRoom: 80_000,

  transitionsPerMap: 20_000,
  segmentsPerDoor: 1_000,
  iconsPerMap: 20_000,
  linesPerMap: 20_000,
  pointsPerLine: 10_000,

  // Grid coordinates, positive and negative. Keeps world-to-screen arithmetic
  // exact in a double, and bounds any work whose cost follows a bounding box
  // rather than a cell count.
  coordinate: 1_000_000,

  nameLength: 1_000,
  notesLength: 100_000,
} as const

export type LimitName = keyof typeof LIMITS

// Carries which cap was exceeded and by how much, so the dialog can say
// something true rather than "the file is too big".
export class FileTooLargeError extends Error {
  readonly limit: LimitName
  readonly allowed: number
  readonly found: number

  constructor(limit: LimitName, found: number) {
    super(`file exceeds the ${limit} limit: ${found} where ${LIMITS[limit]} is the most allowed`)
    this.name = 'FileTooLargeError'
    this.limit = limit
    this.allowed = LIMITS[limit]
    this.found = found
  }
}

// Takes a count rather than the collection it came from, so a caller can check
// a running total before spending it.
export function checkLimit(limit: LimitName, found: number): void {
  if (found > LIMITS[limit]) throw new FileTooLargeError(limit, found)
}

// What a storage provider calls on a file's size before reading it. A file
// over this cap exhausts memory inside the read itself, where no guard in the
// loader can still run.
export function checkByteLength(bytes: number): void {
  checkLimit('bytes', bytes)
}

// Whether a coordinate is one the grid can hold. Safe integers alone are not
// enough: 2^53 is a valid safe integer and no map reaches it.
export function inCoordinateRange(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= LIMITS.coordinate
}

// The project-wide cell total, checked as it grows. Counting to a million and
// refusing afterwards is the hang this is meant to prevent.
export class CellBudget {
  private used = 0

  spend(count: number): void {
    this.used += count
    checkLimit('cellsPerProject', this.used)
  }
}
