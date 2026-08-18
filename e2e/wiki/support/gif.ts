// Assembles a gesture's captured frames into the looping GIF the wiki shows.
//
// Two ffmpeg passes, not one. A single pass picks a palette per frame, and on a
// dark flat-coloured canvas that bands: the same wall renders as a different
// shade once the palette shifts. `palettegen` over the whole sequence followed
// by `paletteuse` gives every frame one palette, and the app's few flat colours
// fit inside 256 exactly, so the dither is off and the output is crisp rather
// than stippled.
//
// The format is a fixed 15 fps frame delay, looping forever, and a length of
// however many frames the gesture took. The loop is asserted against the
// encoded bytes rather than trusted to the flag that requests it, for the
// reason `requireInfiniteLoop` gives. Identical frames encode to identical
// bytes, which is what lets one command regenerate every image without
// rewriting the ones that did not change.
//
// ffmpeg is a system dependency rather than an npm one, so its absence is
// reported by name instead of leaving an empty file behind.
//
// Not a `.spec.ts`, so Playwright collects no tests from it.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const FPS = 15

// What `frameName` produces, as ffmpeg's input pattern.
const FRAME_GLOB = 'frame-%04d.png'

export function frameName(index: number) {
  return `frame-${String(index).padStart(4, '0')}.png`
}

export function encodeGif(framesDir: string, outPath: string) {
  requireFfmpeg()

  const frames = path.join(framesDir, FRAME_GLOB)
  const palette = path.join(framesDir, 'palette.png')

  run(['-framerate', String(FPS), '-i', frames, '-vf', 'palettegen', '-y', palette])
  run([
    '-framerate',
    String(FPS),
    '-i',
    frames,
    '-i',
    palette,
    '-lavfi',
    'paletteuse=dither=none',
    '-loop',
    '0',
    '-y',
    outPath,
  ])

  requireInfiniteLoop(outPath)
}

// Looping is the one property a wiki GIF cannot be published without, and
// `-loop 0` alone does not establish it: ffmpeg's gif muxer already defaults to
// an infinite loop, so the flag agrees with the default rather than enforcing
// anything. The claim is checked against the bytes instead.
//
// A looping GIF carries an application extension block holding "NETSCAPE2.0",
// then a one-byte sub-block length, a one-byte index, and the loop count as a
// little-endian pair. Zero means forever.
function requireInfiniteLoop(gifPath: string) {
  const bytes = readFileSync(gifPath)
  const at = bytes.indexOf('NETSCAPE2.0')
  if (at < 0) throw new Error(`${path.basename(gifPath)} carries no loop extension`)

  const loops = bytes.readUInt16LE(at + 'NETSCAPE2.0'.length + 2)
  if (loops !== 0) throw new Error(`${path.basename(gifPath)} loops ${loops} times, not forever`)
}

function requireFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (probe.error) {
    throw new Error('ffmpeg is not on PATH, and the wiki GIFs cannot be assembled without it')
  }
}

function run(args: string[]) {
  const result = spawnSync('ffmpeg', ['-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.trim() || `exit ${result.status}`}`)
  }
}
