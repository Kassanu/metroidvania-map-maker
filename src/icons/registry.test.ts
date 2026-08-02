import { describe, it, expect } from 'vitest'
import { PLATE_ROUNDED_SQUARE } from '@/canvas/iconBadge'
import { ICONS, getIcon, iconArtCatalogue, listIcons, searchIcons } from './registry'

describe('the icon registry', () => {
  it('derives every accessor from the one array', () => {
    // The promise the registry makes: adding an icon is one entry here and
    // nothing else. Anything maintained beside `ICONS` would drift out of step
    // with it, and these are the three places that could.
    expect(listIcons()).toHaveLength(ICONS.length)
    expect(iconArtCatalogue().size).toBe(ICONS.length)
    expect(searchIcons('')).toHaveLength(ICONS.length)

    for (const entry of ICONS) {
      expect(getIcon(entry.id)).toBe(entry)
      expect(iconArtCatalogue().get(entry.id)).toBeDefined()
      expect(searchIcons(entry.name)).toContain(entry)
    }
  })

  it('keeps ids unique and free of the character reserved for uploads', () => {
    // `iconType` is the save-file format, so a duplicate id would make two
    // icons indistinguishable in a saved project. A colon is reserved for
    // user-supplied icons, so a built-in can never shadow one.
    const ids = ICONS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).not.toContain(':')
  })

  it('falls back to the shared plate, so an entry need only carry its glyph', () => {
    const entry = ICONS.find((candidate) => candidate.plate === undefined)!
    expect(iconArtCatalogue().get(entry.id)!.plate).toBe(PLATE_ROUNDED_SQUARE)
    expect(iconArtCatalogue().get(entry.id)!.glyph).toBe(entry.glyph)
  })

  it('searches ids and keywords, not just names', () => {
    // The set is large enough that the name is often not what a user types:
    // "floppy" has to find the save icon.
    expect(searchIcons('floppy').map((entry) => entry.id)).toContain('save')
    expect(searchIcons('save').map((entry) => entry.id)).toContain('save')
    expect(searchIcons('SAVE').map((entry) => entry.id)).toContain('save')
    expect(searchIcons('   ')).toHaveLength(ICONS.length)
    expect(searchIcons('nothing matches this')).toHaveLength(0)
  })

  it('gives every icon a colour pair for the toolbar to load when it is armed', () => {
    for (const entry of ICONS) {
      expect(entry.defaultColors.plateColor).toMatch(/^#/)
      expect(entry.defaultColors.glyphColor).toMatch(/^#/)
    }
  })

  it('has no entry for an unknown type, which is what makes the fallback reachable', () => {
    expect(getIcon('no-such-icon-type')).toBeUndefined()
    expect(iconArtCatalogue().has('no-such-icon-type')).toBe(false)
  })
})
