// What an exported file is called.
//
// Room names are not unique, may be empty, and may hold anything a person can
// type, so the name alone cannot identify a file. The id can, and always does,
// which is why it is the half that never gets dropped: `<slug>--<room-id>.json`
// is unique by construction, readable, and stable across exports, so
// re-exporting overwrites rather than accumulates.

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
