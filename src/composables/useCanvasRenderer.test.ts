import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { renderMap, type MapScene } from '@/canvas/renderMap'
import { useCanvasRenderer, type CanvasTargets, type SceneInput } from './useCanvasRenderer'
import { iconArtCatalogue } from '@/icons/registry'
import type { FakeContext2D } from '@/test-setup'

// The renderer is replaced rather than driven, because what this file is about
// is the scene the composable assembles, and that value is visible nowhere else:
// nothing reads `dpr` until the dither lands, so drawing it changes no pixel.
vi.mock('@/canvas/renderMap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/canvas/renderMap')>()),
  renderMap: vi.fn(),
}))

const original = window.devicePixelRatio

afterEach(() => {
  vi.mocked(renderMap).mockClear()
  Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
})

function atRatio(ratio: number) {
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true })
}

function sceneInput(): SceneInput {
  return {
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    bounds: { minCol: 0, minRow: 0, maxCol: 9, maxRow: 9 },
    tileSize: 32,
    map: null,
    areas: new Map(),
    lockTypes: new Map(),
    iconArt: iconArtCatalogue(),
    teleports: { ends: [], lines: [] },
    ghost: null,
    brushPreview: null,
    boxPreview: null,
    pendingTeleport: null,
    selected: new Set(),
    selectedRooms: new Set(),
    selectedCells: new Set(),
    handleRoom: null,
    marquee: null,
    showPage: true,
    showGrid: true,
    showRulers: false,
    rulerUnits: 'cells',
    showTransitions: true,
    showTeleportLines: true,
    showIcons: true,
    showLines: true,
    showAllLabels: false,
    hoveredLabel: null,
    selectedMarkup: new Set(),
  }
}

function mounted() {
  const main = document.createElement('canvas')
  // Backing-store pixels, the way `resize` would have sized them.
  main.width = 800
  main.height = 600

  const targets: CanvasTargets = {
    container: ref(document.createElement('div')),
    main: ref(main),
    topRuler: ref(null),
    leftRuler: ref(null),
  }
  const renderer = useCanvasRenderer(targets, sceneInput)
  return { renderer, main }
}

function drawnScene(): MapScene {
  const call = vi.mocked(renderMap).mock.calls.at(-1)
  if (!call) throw new Error('renderMap was not called')
  return call[3]
}

describe('useCanvasRenderer', () => {
  describe('the scene carries the ratio the context was scaled by', () => {
    it('hands the renderer the display it is drawing on', () => {
      atRatio(2)
      const { renderer } = mounted()

      renderer.draw()

      expect(drawnScene().dpr).toBe(2)
    })

    it('follows the ratio from one draw to the next', () => {
      const { renderer } = mounted()

      atRatio(1)
      renderer.draw()
      expect(drawnScene().dpr).toBe(1)

      atRatio(3)
      renderer.draw()
      expect(drawnScene().dpr).toBe(3)
    })

    // Measured once. The scene and the transform disagreeing would put the
    // dither's squares on a different grid from the thing they are drawn over.
    it('scales the transform by the same number it puts on the scene', () => {
      atRatio(2)
      const { renderer, main } = mounted()

      renderer.draw()

      const ctx = main.getContext('2d') as unknown as FakeContext2D
      expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
      expect(drawnScene().dpr).toBe(2)
    })

    // A ratio of 0 would divide the canvas size by nothing and put NaN through
    // every conversion downstream.
    it('falls back to 1 where the browser reports nothing usable', () => {
      atRatio(0)
      const { renderer } = mounted()

      renderer.draw()

      expect(drawnScene().dpr).toBe(1)
    })
  })

  // The CSS size comes off the backing store by the same ratio, so a scene
  // measured at one ratio and drawn at another would be the wrong size.
  it('sizes the draw in CSS pixels', () => {
    atRatio(2)
    const { renderer } = mounted()

    renderer.draw()

    const [, width, height] = vi.mocked(renderMap).mock.calls.at(-1)!
    expect([width, height]).toEqual([400, 300])
  })

  it('draws nothing when there is no canvas to draw on', () => {
    const targets: CanvasTargets = {
      container: ref(null),
      main: ref(null),
      topRuler: ref(null),
      leftRuler: ref(null),
    }

    useCanvasRenderer(targets, sceneInput).draw()

    expect(renderMap).not.toHaveBeenCalled()
  })
})
