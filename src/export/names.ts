// What an exported file is called.
//
// Two ways of earning uniqueness live here, and they hold over different
// scopes. A room file earns it from the room id it appends: unique across the
// project and stable across exports, so re-exporting overwrites rather than
// accumulates. An archive entry earns it from its position among the other
// entries: unique only within that archive, and not stable across exports.
//
// Room names are not unique, may be empty, and may hold anything a person can
// type, so the name alone cannot identify a file.

const SEPARATOR = '--'

// Anything that is not a letter or a digit, in any script. Unicode-aware on
// purpose: a room called 日本 slugs to itself rather than to nothing, and both
// filesystems and zip entry names take UTF-8.
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]+/gu

// Short enough that the slug cannot dominate the name it is only half of. The
// id and the extension are what make the file findable; the slug is there to
// be read.
const MAX_SLUG = 60

// Composed form first, so a name typed with combining marks slugs identically
// to the same name typed precomposed.
export function slugify(name: string): string {
  return (
    name
      .normalize('NFC')
      .toLowerCase()
      .replace(NOT_A_WORD_CHARACTER, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG)
      // Again after the truncation, which can leave a trailing separator.
      .replace(/-+$/, '')
  )
}

// Falls back to the id alone when the name slugs to nothing, which is what an
// unnamed room and a name made entirely of punctuation both produce. A leading
// separator would be the alternative, and a file called `--room_a3f9`.
export function roomFileName(name: string, roomId: string): string {
  const slug = slugify(name)
  return slug ? `${slug}${SEPARATOR}${roomId}.json` : `${roomId}.json`
}

// Names made unique within one archive, in the order they were given, by
// suffixing the second and later repeats before the extension. Order is the
// caller's, so a picker that lists tabs in tab order gets `-2` on the later
// tab rather than on whichever happened to be built first.
//
// Every name produced is reserved as it goes, so a suffix cannot collide with a
// name that was already in the list: `a`, `a`, `a-2` yields `a`, `a-2`, `a-2-2`
// rather than two files called `a-2`, one of which would be lost on extraction.
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>()
  return names.map((name) => {
    if (!taken.has(name)) {
      taken.add(name)
      return name
    }
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    for (let suffix = 2; ; suffix++) {
      const candidate = `${stem}-${suffix}${extension}`
      if (!taken.has(candidate)) {
        taken.add(candidate)
        return candidate
      }
    }
  })
}
