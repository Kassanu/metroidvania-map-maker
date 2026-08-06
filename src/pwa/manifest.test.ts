import { describe, it, expect } from 'vitest'
import { FILE_EXTENSION, MVM_MEDIA_TYPE } from '@/core/storage/provider'
import { appIcons, fileHandlers } from './manifest'

// The manifest entry is the whole of the file association: without it, double
// clicking a `.mvm` does nothing at all. These pin the parts of it a rename
// or a tidy could silently change.

describe('the file association', () => {
  it('claims exactly one handler, at the app itself', () => {
    const handlers = fileHandlers('/somewhere/')
    expect(handlers).toHaveLength(1)
    expect(handlers[0].action).toBe('/somewhere/')
  })

  // What the operating system matches on. A media type it has never heard of
  // matches nothing on its own.
  it('claims the extension the app actually writes', () => {
    const [handler] = fileHandlers('/')
    expect(handler.accept[MVM_MEDIA_TYPE]).toEqual([FILE_EXTENSION])
  })

  // Drift here would register the app for files it does not write, and leave
  // the ones it does write unassociated.
  it('names the same type the save picker offers', () => {
    const [handler] = fileHandlers('/')
    expect(Object.keys(handler.accept)).toEqual([MVM_MEDIA_TYPE])
    expect(MVM_MEDIA_TYPE).toBe('application/x-mvm+json')
    expect(FILE_EXTENSION).toBe('.mvm')
  })

  // A second window would be started with a cold session, which is the one
  // case where the unsaved-work guard has nothing to guard and the user's
  // open project is left behind in the window they were using.
  it('sends a launch to a window that is already open', () => {
    expect(fileHandlers('/')[0].launch_type).toBe('single-client')
  })

  // Without an icon the shell shows a generic document, which is what the
  // entry looked like before the art existed.
  it('offers an icon at every size a shell asks for', () => {
    const [handler] = fileHandlers('/')
    expect(handler.icons.map((icon) => icon.sizes)).toEqual(['16x16', '32x32', '48x48', '256x256'])
    for (const icon of handler.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src).toMatch(/^file-icon-\d+\.png$/)
      expect(icon.src).toContain(icon.sizes.split('x')[0])
    }
  })
})

// A manifest naming a file that is not in `public/` is inert, and inert looks
// exactly like untested. The glob is rooted at the project, so this is the
// real directory rather than a list restated.
describe('every icon the manifest names', () => {
  const shipped = new Set(
    Object.keys(import.meta.glob('/public/*.png')).map((path) => path.replace('/public/', '')),
  )

  it('is a file that has been generated', () => {
    expect(shipped.size).toBeGreaterThan(0)
    const named = [...appIcons(), ...fileHandlers('/')[0].icons].map((icon) => icon.src)
    expect(named.filter((src) => !shipped.has(src))).toEqual([])
  })

  it('covers an installable app: a small one, a large one, and a maskable one', () => {
    const icons = appIcons()
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
    expect(icons.map((icon) => icon.sizes)).toContain('512x512')
    expect(icons.map((icon) => icon.sizes)).toContain('192x192')
  })
})
