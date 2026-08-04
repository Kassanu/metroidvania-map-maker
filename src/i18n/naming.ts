// Google-Sheets-style duplicate naming, shared by everything that copies a
// named thing: "Map 1" -> "Map 1 copy" -> "Map 1 copy 2", and the same for
// rooms.
//
// Duplicating a copy re-derives the original base name by stripping a trailing
// "copy" or "copy N", so it continues one sequence instead of nesting into
// "copy copy". The templates are messages, so a translation that puts the word
// first still round-trips: the matcher is built from the same string.

import { t, templateMatcher } from './index'
import { parseCell } from '@/core/cell'
import type { Room } from '@/core/types'

// What to call a room in a list. Rooms start unnamed, so every surface that
// shows one needs the same answer, and a positional fallback is the only one
// that distinguishes two unnamed rooms from each other.
//
// The cell is the room's row-major first: topmost, then leftmost, which is the
// tiebreak the rest of the app uses. Its bounding-box corner would be simpler
// and wrong, since an L-shaped room need not own it.
export function roomLabel(room: Room): string {
  if (room.name) return room.name
  let first: { x: number; y: number } | null = null
  for (const key of room.cells) {
    const cell = parseCell(key)
    if (!first || cell.y < first.y || (cell.y === first.y && cell.x < first.x)) first = cell
  }
  return first ? t('name.roomAt', { cell: `${first.x},${first.y}` }) : t('name.roomUnplaced')
}

// The name a room gets when there is no source name to derive one from: a
// pasted cell fragment carries geometry and content but no identity.
//
// The lowest number no existing name is using, the same scan the map names
// follow, and with the same consequence: a name in another locale's shape does
// not take part in the numbering.
export function freshRoomName(existingNames: readonly string[]): string {
  const matchRoomName = templateMatcher(t('name.room'), { n: '\\d+' })
  const used = new Set(
    existingNames
      .map((name) => matchRoomName(name)?.n)
      .filter((n): n is string => n !== undefined)
      .map(Number),
  )
  let n = 1
  while (used.has(n)) n++
  return t('name.room', { n })
}

// The name a new area gets from the Hierarchy's `+`. Same lowest-unused scan
// as rooms and maps, and the same consequence: only an exact match counts as
// used, so `Area 07` and `Area 2 copy` both leave their numbers free.
export function freshAreaName(existingNames: readonly string[]): string {
  const matchAreaName = templateMatcher(t('name.area'), { n: '\\d+' })
  const used = new Set(
    existingNames
      .map((name) => matchAreaName(name)?.n)
      .filter((n): n is string => n !== undefined)
      .map(Number),
  )
  let n = 1
  while (used.has(n)) n++
  return t('name.area', { n })
}

// `existingNames` is what the new name has to avoid. Whichever scope the caller
// is naming within: every map in the project, or every room on one map.
export function copyName(originalName: string, existingNames: readonly string[]): string {
  const matchCopy = templateMatcher(t('name.copy'), { base: '.*' })
  const matchCopyNth = templateMatcher(t('name.copyNth'), { base: '.*', n: '\\d+' })

  const base = matchCopyNth(originalName)?.base ?? matchCopy(originalName)?.base ?? originalName
  const firstCopy = t('name.copy', { base })
  if (!existingNames.includes(firstCopy)) return firstCopy

  let n = 2
  while (existingNames.includes(t('name.copyNth', { base, n }))) n++
  return t('name.copyNth', { base, n })
}

// The `nameFor` a whole-object duplicate or paste passes down. Stateful across
// the batch on purpose: duplicating three rooms at once has to avoid the names
// the first two just took, which a pure function of the original name cannot.
export function copyNamer(existingNames: readonly string[]) {
  const taken = [...existingNames]
  return ({ name }: { name: string; index: number }) => {
    const next = copyName(name, taken)
    taken.push(next)
    return next
  }
}
