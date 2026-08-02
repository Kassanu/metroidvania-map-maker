import { describe, it, expect } from 'vitest'
import { t, currentLocale, resolveSystemLocale, templateMatcher } from './index'
import { en } from './messages/en'

describe('t', () => {
  it('returns the message for a key', () => {
    expect(t('menu.help.cheatSheet')).toBe('Cheat sheet')
  })

  it('fills {placeholders} from the params', () => {
    expect(t('tab.deleteTitle', { name: 'Map 1' })).toBe('Delete "Map 1"?')
  })

  it('leaves a placeholder alone when no value was passed for it', () => {
    expect(t('tab.deleteTitle', { wrong: 'x' })).toBe('Delete "{name}"?')
  })

  it('defaults to English', () => {
    expect(currentLocale()).toBe('en')
  })

  it('has no empty messages in the catalogue', () => {
    const blank = Object.entries(en).filter(([, value]) => value.trim() === '')
    expect(blank).toEqual([])
  })
})

describe('resolveSystemLocale', () => {
  it('takes the first supported language from the browser list', () => {
    expect(resolveSystemLocale(['en'])).toBe('en')
  })

  it('matches a region tag on its base language', () => {
    expect(resolveSystemLocale(['en-GB'])).toBe('en')
  })

  it('skips languages it has no catalogue for', () => {
    expect(resolveSystemLocale(['fr-FR', 'de', 'en-US'])).toBe('en')
  })

  it('falls back to English when nothing matches', () => {
    expect(resolveSystemLocale(['fr-FR'])).toBe('en')
    expect(resolveSystemLocale([])).toBe('en')
  })
})

describe('templateMatcher', () => {
  it('pulls placeholder values back out of a rendered string', () => {
    const match = templateMatcher('Map {n}', { n: '\\d+' })
    expect(match('Map 3')).toEqual({ n: '3' })
  })

  it('returns null for a string that does not fit the template', () => {
    const match = templateMatcher('Map {n}', { n: '\\d+' })
    expect(match('Map three')).toBeNull()
    expect(match('Overworld')).toBeNull()
    expect(match('My Map 3')).toBeNull() // anchored: no partial matches
  })

  it('round-trips whatever t() produced', () => {
    const match = templateMatcher(en['name.map'], { n: '\\d+' })
    expect(match(t('name.map', { n: 12 }))).toEqual({ n: '12' })
  })

  it('handles several placeholders, and a greedy base', () => {
    const match = templateMatcher('{base} copy {n}', { base: '.*', n: '\\d+' })
    expect(match('Map 1 copy 2')).toEqual({ base: 'Map 1', n: '2' })
    expect(match('A copy copy 3')).toEqual({ base: 'A copy', n: '3' })
  })

  it('treats regex metacharacters in the template as literal text', () => {
    const match = templateMatcher('Map ({n})', { n: '\\d+' })
    expect(match('Map (7)')).toEqual({ n: '7' })
    expect(match('Map 7')).toBeNull()
  })
})
