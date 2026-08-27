import { afterEach, describe, expect, it, vi } from 'vitest'
import { readCanvasPaletteAs } from './palette'

// jsdom loads no stylesheet, so every custom property resolves empty and the
// colours themselves cannot be asserted here. What is asserted is the stamping,
// which is the whole of what this function adds: `color.test.ts` is where the
// declarations are held to their form.
function watchTheme() {
  const seen: (string | null)[] = []
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
    seen.push(document.documentElement.getAttribute('data-theme'))
    return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration
  })
  return seen
}

describe('reading a theme that is not applied', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-theme')
  })

  it('reads while the theme it was asked for is stamped', () => {
    const seen = watchTheme()
    readCanvasPaletteAs('dark')
    expect(seen).toEqual(['dark'])
  })

  it('restores the theme that was applied', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    readCanvasPaletteAs('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  // 'system' is the absence of the attribute, so restoring it means removing
  // the stamp rather than writing anything back.
  it('leaves no stamp where there was none', () => {
    readCanvasPaletteAs('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('restores even when the read throws', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('no style engine')
    })

    expect(() => readCanvasPaletteAs('dark')).toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('answers the palette shape the renderer reads', () => {
    watchTheme()
    expect(readCanvasPaletteAs('light')).toHaveProperty('page')
  })
})
