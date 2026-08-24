import { vi, type Mock } from 'vitest'

// The one recording 2D context every unit test draws through, whether it built
// the context itself or reached it via `canvasEl.getContext('2d')`.
//
// Four things here are load-bearing:
//
//   * Every method is a `vi.fn()` wrapper. Component tests read `.mock.calls`
//     and call `.mockClear()`, so a plain function would break them.
//   * `fills` holds `fillRect` calls and nothing else. Its entries are asserted
//     with `toEqual({ style, rect })`, which fails on an extra key, so a bare
//     `fill()` publishes into `pathFills` instead.
//   * A path is published when it is consumed, by `stroke`, `fill` or `clip`.
//     `stroke` publishes only its segments, which is the shape stroke
//     assertions already read.
//   * `mockClear()` empties a method's vitest call log but not the arrays
//     below. Nothing reads both today; a test that clears and then reads an
//     array sees entries from before the clear.
//
// The method surface is the union of what the renderer, the ruler and the
// composable call. `setTransform` and `rotate` are as required as `fillRect`:
// the composable calls the first on every draw and the ruler calls the second.

// What `createPattern` answers. Carries the canvas it was built from, so a test
// reaches the tile's own records through `recordsOf(token.source)`.
export interface PatternToken {
  readonly source: unknown
  readonly repetition: string | null
}

export type FillStyle = string | PatternToken

// A path as it stood when something consumed it. Rect subpaths and line
// segments are kept apart because a clip is usually one rect and a room
// outline is usually segments, and merging them loses which was which.
export interface RecordedPath {
  // Each `rect()` call, as [x, y, width, height].
  rects: number[][]
  // Each `lineTo()`, as [fromX, fromY, toX, toY].
  segments: number[][]
}

export interface RecordedFill {
  style: FillStyle
  rect: number[]
}

export interface RecordedPathFill extends RecordedPath {
  style: FillStyle
}

export interface RecordedClip extends RecordedPath {
  rule: string | undefined
}

export interface RecordedStroke {
  style: string
  width: number
  dash: number[]
  join: string
  segments: number[][]
}

export interface RecordedLabel {
  text: string
  style: FillStyle
  at: number[]
}

export interface RecordedChip {
  style: FillStyle
  rect: number[]
}

export interface RecordedBadge {
  style: FillStyle
  data: string
  x: number
  y: number
  scale: number
}

export interface CanvasRecords {
  fills: RecordedFill[]
  pathFills: RecordedPathFill[]
  clips: RecordedClip[]
  strokes: RecordedStroke[]
  labels: RecordedLabel[]
  chips: RecordedChip[]
  badges: RecordedBadge[]
  patterns: PatternToken[]
}

export interface FakeContext2D {
  fillStyle: FillStyle
  strokeStyle: string
  lineWidth: number
  lineJoin: string
  lineCap: string
  font: string
  textAlign: string
  textBaseline: string
  fillRect: Mock<(...args: number[]) => void>
  clearRect: Mock<(...args: number[]) => void>
  beginPath: Mock<() => void>
  moveTo: Mock<(...args: number[]) => void>
  lineTo: Mock<(...args: number[]) => void>
  rect: Mock<(...args: number[]) => void>
  closePath: Mock<() => void>
  stroke: Mock<() => void>
  fill: Mock<(path?: unknown, rule?: string) => void>
  clip: Mock<(path?: unknown, rule?: string) => void>
  save: Mock<() => void>
  restore: Mock<() => void>
  scale: Mock<(...args: number[]) => void>
  setTransform: Mock<(...args: number[]) => void>
  translate: Mock<(...args: number[]) => void>
  rotate: Mock<(...args: number[]) => void>
  fillText: Mock<(...args: [string, number, number]) => void>
  measureText: Mock<(text: string) => { width: number }>
  roundRect: Mock<(...args: number[]) => void>
  setLineDash: Mock<(segments: number[]) => void>
  createPattern: Mock<(source: unknown, repetition: string | null) => PatternToken>
}

export interface RecordingContext extends CanvasRecords {
  ctx: FakeContext2D
}

export function createRecordingContext(): RecordingContext {
  const records: CanvasRecords = {
    fills: [],
    pathFills: [],
    clips: [],
    strokes: [],
    labels: [],
    chips: [],
    badges: [],
    patterns: [],
  }

  // The path being built, and the pen. Both reset when the path is consumed,
  // matching a real context, where consuming leaves the path in place but
  // every caller here begins a new one.
  let rects: number[][] = []
  let segments: number[][] = []
  let cursor: number[] = [0, 0]
  let dash: number[] = []

  function takePath(): RecordedPath {
    const path = { rects, segments }
    rects = []
    segments = []
    return path
  }

  // Only translate and uniform scale are tracked, which is all the badges use.
  let transform = { x: 0, y: 0, scale: 1 }
  const saved: (typeof transform)[] = []

  const ctx: FakeContext2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: vi.fn((text: string, x: number, y: number) => {
      records.labels.push({ text, style: ctx.fillStyle, at: [x, y] })
    }),
    clearRect: vi.fn(),
    fillRect: vi.fn((...rect: number[]) => {
      records.fills.push({ style: ctx.fillStyle, rect })
    }),
    beginPath: vi.fn(() => {
      rects = []
      segments = []
    }),
    moveTo: vi.fn((x: number, y: number) => {
      cursor = [x, y]
    }),
    lineTo: vi.fn((x: number, y: number) => {
      segments.push([...cursor, x, y])
      cursor = [x, y]
    }),
    rect: vi.fn((x: number, y: number, width: number, height: number) => {
      rects.push([x, y, width, height])
    }),
    closePath: vi.fn(),
    stroke: vi.fn(() => {
      const path = takePath()
      records.strokes.push({
        style: ctx.strokeStyle,
        width: ctx.lineWidth,
        dash,
        join: ctx.lineJoin,
        segments: path.segments,
      })
    }),
    setLineDash: vi.fn((next: number[]) => {
      dash = next
    }),
    save: vi.fn(() => {
      saved.push({ ...transform })
    }),
    restore: vi.fn(() => {
      transform = saved.pop() ?? transform
    }),
    translate: vi.fn((x: number, y: number) => {
      transform.x += x * transform.scale
      transform.y += y * transform.scale
    }),
    scale: vi.fn((k: number) => {
      transform.scale *= k
    }),
    setTransform: vi.fn(),
    rotate: vi.fn(),
    // Two callers, told apart by the argument: a badge fills a Path2D, and
    // anything else fills the path just built. A lone fill rule is a string,
    // so only an object is a path.
    fill: vi.fn((path?: unknown) => {
      if (typeof path === 'object' && path !== null) {
        const { data } = path as { data: string }
        records.badges.push({ style: ctx.fillStyle, data, ...transform })
        return
      }
      records.pathFills.push({ style: ctx.fillStyle, ...takePath() })
    }),
    clip: vi.fn((path?: unknown, rule?: string) => {
      const fillRule = typeof path === 'string' ? path : rule
      records.clips.push({ ...takePath(), rule: fillRule })
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    roundRect: vi.fn((x: number, y: number, width: number, height: number) => {
      records.chips.push({ style: ctx.fillStyle, rect: [x, y, width, height] })
    }),
    createPattern: vi.fn((source: unknown, repetition: string | null) => {
      const token: PatternToken = { source, repetition }
      records.patterns.push(token)
      return token
    }),
  }

  return { ctx, ...records }
}
