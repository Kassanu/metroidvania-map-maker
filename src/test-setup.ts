import { createApp } from 'vue'
import { createAppPinia } from '@/stores/pinia'
import { createRecordingContext, type CanvasRecords } from '@/canvas/testContext'
import { wasRefused } from '@/core/outcome'
import type { GestureStart } from '@/gestures/gestureStart'

export type { FakeContext2D } from '@/canvas/testContext'

// Pinia only applies plugins registered with pinia.use() once the instance
// has been installed into a Vue app, so a store test doing nothing but
// setActivePinia() would silently run without the persistence plugin. A
// throwaway app gets the plugins installed (this is what @pinia/testing does
// internally). Component tests that pass the pinia to mount() are already
// covered, but they can use this too and stay consistent.
export function createTestPinia() {
  const pinia = createAppPinia()
  createApp({}).use(pinia)
  return pinia
}

// jsdom doesn't implement IndexedDB, which the recent-files and recovery
// stores are built on. A file-handle and a multi-megabyte snapshot are both
// things localStorage cannot hold, so there is no simpler backend to fall back
// to in tests.
if (typeof globalThis.indexedDB === 'undefined') {
  const { indexedDB, IDBKeyRange } = await import('fake-indexeddb')
  globalThis.indexedDB = indexedDB
  globalThis.IDBKeyRange = IDBKeyRange
}

// jsdom doesn't implement ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom doesn't implement Path2D, which the icon badges are drawn with. The
// stub keeps the path data so a fake context can assert which icon was drawn.
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    readonly data: string
    constructor(data = '') {
      this.data = data
    }
  } as unknown as typeof globalThis.Path2D
}

// jsdom doesn't implement scrollIntoView (or real layout/scrolling at all).
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom doesn't implement matchMedia (used for prefers-color-scheme, both
// style.css's own media query and CanvasRegion's redraw-on-OS-theme-change).
if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom doesn't implement pointer capture (used by tab drag-reorder).
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
}

// jsdom doesn't implement the Canvas 2D API at all (getContext('2d') returns
// null unless the optional `canvas` npm package is installed, which this
// project doesn't use). CanvasRegion's draw() needs a real-ish context to
// call methods on, and so does anything that builds an offscreen canvas.
//
// Memoized per canvas element (a WeakMap, matching the real getContext's
// idempotency) so a test can call `canvasEl.getContext('2d')` itself and get
// back the exact same spy-able object the component drew with.
//
// The context is the recorder from `canvas/testContext.ts`, which is what
// makes a tile drawn into an offscreen canvas readable from the test that
// asserts on the map it was filled into: both record through the same double.
const recordings = new WeakMap<HTMLCanvasElement, ReturnType<typeof createRecordingContext>>()

function recordingFor(canvas: HTMLCanvasElement) {
  let recording = recordings.get(canvas)
  if (!recording) {
    recording = createRecordingContext()
    recordings.set(canvas, recording)
  }
  return recording
}

// What was drawn into a canvas the test did not build itself. Keyed on the
// element rather than hung off the context, because the canvas is what a
// caller has: a pattern token carries the canvas its tile was drawn into, so
// `recordsOf(token.source)` is how the tile's own colours are read back.
export function recordsOf(canvas: HTMLCanvasElement): CanvasRecords {
  return recordingFor(canvas)
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): unknown {
    // Skip jsdom's real getContext. It always logs a noisy "Not implemented"
    // warning and returns null for every context type since the optional
    // `canvas` package isn't installed, so there's nothing to gain by calling
    // through to it first.
    if (type !== '2d') return null
    return recordingFor(this).ctx
  } as typeof HTMLCanvasElement.prototype.getContext
}

// A gesture a test expects to have started. It fails where the refusal is,
// rather than at the first property poke a dozen lines later, and it narrows,
// so the test that follows reads as it did before the gesture layer grew a
// refusal. A test about the refusal itself asserts on the value instead.
export function mustStart<T>(begun: GestureStart<T>): T {
  if (wasRefused(begun)) throw new Error(`gesture refused: ${begun.refused}`)
  return begun
}
