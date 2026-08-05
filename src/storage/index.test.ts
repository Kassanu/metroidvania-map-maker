import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageProvider } from '@/core/storage/provider'
import { getStorageProvider, setStorageProvider } from './index'

afterEach(() => {
  setStorageProvider(null)
  vi.unstubAllGlobals()
})

describe('provider selection', () => {
  it('takes the in-place provider where the capability exists', () => {
    setStorageProvider(null)
    vi.stubGlobal('showSaveFilePicker', () => {})
    expect(getStorageProvider().canSaveInPlace).toBe(true)
  })

  it('falls back to downloads where it does not', () => {
    setStorageProvider(null)
    // Deleting rather than stubbing undefined: the check is `in window`, which
    // a defined-but-undefined property would still satisfy.
    vi.stubGlobal('window', {})
    expect(getStorageProvider().canSaveInPlace).toBe(false)
  })

  it('answers with one instance per session', () => {
    setStorageProvider(null)
    expect(getStorageProvider()).toBe(getStorageProvider())
  })

  it('can be replaced, and restored to capability selection', () => {
    const stub = { id: 'stub' } as StorageProvider
    setStorageProvider(stub)
    expect(getStorageProvider()).toBe(stub)

    setStorageProvider(null)
    expect(getStorageProvider()).not.toBe(stub)
  })
})

// The seam is only a seam while nothing reaches around it. A component that
// imported a provider directly would work today and be the thing that has to
// be found and undone when a cloud provider is added.
describe('nothing above the seam names a concrete provider', () => {
  // Read through Vite rather than `node:fs`, so the test needs no node types
  // in an app tsconfig that deliberately withholds them from browser code.
  const sources = import.meta.glob('/src/**/*.{ts,vue}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  it('leaves fsaProvider and downloadProvider imported only from src/storage', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.startsWith('/src/storage/'))
      .filter(([, text]) => /from '[^']*(fsaProvider|downloadProvider)'/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('is looking at the whole app, not an empty glob', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
  })
})
