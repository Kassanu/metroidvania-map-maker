// Google-Sheets-style duplicate naming, shared by everything that copies a
// named thing: "Map 1" -> "Map 1 copy" -> "Map 1 copy 2", and the same for
// rooms.
//
// Duplicating a copy re-derives the original base name by stripping a trailing
// "copy" or "copy N", so it continues one sequence instead of nesting into
// "copy copy". The templates are messages, so a translation that puts the word
// first still round-trips: the matcher is built from the same string.

import { t, templateMatcher } from './index'

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
