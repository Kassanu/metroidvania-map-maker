import { describe, expect, it } from 'vitest'
import { roomFileName, slugify, uniqueNames } from './names'

describe('slugify', () => {
  it('lowercases and joins words with a single dash', () => {
    expect(slugify('Landing Site')).toBe('landing-site')
    expect(slugify('  Crateria   East  ')).toBe('crateria-east')
  })

  it('collapses a run of punctuation rather than one dash per character', () => {
    expect(slugify('Wrecked Ship (west) -- lower!!')).toBe('wrecked-ship-west-lower')
  })

  it('keeps letters and digits from any script', () => {
    expect(slugify('日本 2')).toBe('日本-2')
    expect(slugify('Хранилище')).toBe('хранилище')
  })

  it('slugs a decomposed name the same as a precomposed one', () => {
    // Escapes rather than literals: the two are indistinguishable in a source
    // file, so a test written with literals would pass whatever this did.
    const decomposed = 'Fermi\u0301'
    const precomposed = 'Ferm\u00ed'
    expect(decomposed).not.toBe(precomposed)
    expect(slugify(decomposed)).toBe(slugify(precomposed))
  })

  it('is empty when there is nothing to keep', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('!!! ??? ---')).toBe('')
  })

  it('caps its length without leaving a trailing dash', () => {
    const slug = slugify('word '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('roomFileName', () => {
  it('joins the slug and the id with a double dash', () => {
    expect(roomFileName('Landing Site', 'room_k3f9a2xy')).toBe('landing-site--room_k3f9a2xy.json')
  })

  it('falls back to the id alone when the name slugs to nothing', () => {
    expect(roomFileName('', 'room_01')).toBe('room_01.json')
    expect(roomFileName('***', 'room_01')).toBe('room_01.json')
  })

  it('keeps two rooms sharing a name apart', () => {
    // Names are not unique and the id is the half that always is, which is why
    // it is never the part that gets dropped.
    expect(roomFileName('Corridor', 'room_01')).not.toBe(roomFileName('Corridor', 'room_02'))
  })
})

// The other way a name earns uniqueness: position among its neighbours rather
// than an id appended to it. Unique within one archive and nowhere else.
describe('uniqueNames', () => {
  it('leaves names that do not repeat exactly as they were', () => {
    expect(uniqueNames(['surface.png', 'caves.png'])).toEqual(['surface.png', 'caves.png'])
  })

  it('suffixes the second and later repeats, in the order it was given', () => {
    expect(uniqueNames(['brinstar.png', 'brinstar.png', 'brinstar.png'])).toEqual([
      'brinstar.png',
      'brinstar-2.png',
      'brinstar-3.png',
    ])
  })

  it('puts the suffix before the extension rather than after it', () => {
    expect(uniqueNames(['map.png', 'map.png'])[1]).toBe('map-2.png')
  })

  it('extends a name that has no extension', () => {
    expect(uniqueNames(['map', 'map'])).toEqual(['map', 'map-2'])
  })

  // Otherwise two entries would both be called `map-2.png` and extraction
  // would silently keep one of them.
  it('does not hand a suffix to a name that is already taken', () => {
    expect(uniqueNames(['map.png', 'map.png', 'map-2.png'])).toEqual([
      'map.png',
      'map-2.png',
      'map-2-2.png',
    ])
  })

  it('resolves a repeat whose suffix is taken further down the list', () => {
    expect(uniqueNames(['map-2.png', 'map.png', 'map.png'])).toEqual([
      'map-2.png',
      'map.png',
      'map-3.png',
    ])
  })
})
