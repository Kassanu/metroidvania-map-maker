import { describe, expect, it } from 'vitest'
import { roomFileName, slugify } from './names'

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
