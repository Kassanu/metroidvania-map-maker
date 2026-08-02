import { vi, type Mock } from 'vitest'
import { createApp } from 'vue'
import { createAppPinia } from '@/stores/pinia'

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

// jsdom doesn't implement ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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
// call methods on. This fakes just enough of it to run without crashing.
// Memoized per canvas element (a WeakMap, matching the real getContext's
// idempotency) so a test can call `canvasEl.getContext('2d')` itself and get
// back the exact same spy-able object the component drew with.
export interface FakeContext2D {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  fillRect: Mock<(...args: number[]) => void>
  clearRect: Mock<(...args: number[]) => void>
  beginPath: Mock<() => void>
  moveTo: Mock<(...args: number[]) => void>
  lineTo: Mock<(...args: number[]) => void>
  stroke: Mock<() => void>
  save: Mock<() => void>
  restore: Mock<() => void>
  scale: Mock<(...args: number[]) => void>
  setTransform: Mock<(...args: number[]) => void>
  translate: Mock<(...args: number[]) => void>
  rotate: Mock<(...args: number[]) => void>
  fillText: Mock<(...args: [string, number, number]) => void>
  setLineDash: Mock<(segments: number[]) => void>
}

function createFakeContext2D(): FakeContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
  }
}

const fakeContexts = new WeakMap<HTMLCanvasElement, FakeContext2D>()

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
    if (!fakeContexts.has(this)) fakeContexts.set(this, createFakeContext2D())
    return fakeContexts.get(this)
  } as typeof HTMLCanvasElement.prototype.getContext
}
