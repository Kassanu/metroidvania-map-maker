import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@/canvas/brush'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useToolsStore } from './tools'
import { useModeStore } from './mode'
import { useSelectionStore } from './selection'
import { mapScope, useModelStore } from './model'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'

describe('tools store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
    localStorage.clear()
  })

  it('starts with erase off and a 1×1 brush', () => {
    const tools = useToolsStore()
    expect(tools.erase).toBe(false)
    expect(tools.brushSize).toBe(1)
  })

  describe('brush size', () => {
    // Clamped in the store rather than at each call site, so `[` at the floor
    // and `]` at the ceiling are quiet no-ops wherever they arrive from.
    it('stops at the floor and the ceiling', () => {
      const tools = useToolsStore()

      tools.shrinkBrush()
      expect(tools.brushSize).toBe(MIN_BRUSH_SIZE)

      tools.setBrushSize(MAX_BRUSH_SIZE)
      tools.growBrush()
      expect(tools.brushSize).toBe(MAX_BRUSH_SIZE)
    })

    it('steps one at a time', () => {
      const tools = useToolsStore()
      tools.growBrush()
      tools.growBrush()
      expect(tools.brushSize).toBe(3)
      tools.shrinkBrush()
      expect(tools.brushSize).toBe(2)
    })

    it('admits no fractional size', () => {
      const tools = useToolsStore()
      tools.setBrushSize(2.5)
      expect(Number.isInteger(tools.brushSize)).toBe(true)
    })
  })

  // Rooms and cells are different tables, different move ops and different
  // deletes, so the granularity cannot carry a selection across.
  describe('select sub-mode', () => {
    function selectRoom() {
      const model = useModelStore()
      const selection = useSelectionStore()
      const mapId = model.project.maps[0]
      const room = model.run('Paint', mapScope(mapId), (tx) =>
        paintCells(tx, model.project, model.project.mapsById.get(mapId)!, ['0,0'], {
          areaId: WORLD_AREA_ID,
        }),
      )
      selection.set([{ kind: 'room', id: room.id }], mapId)
      return selection
    }

    it('starts on rooms', () => {
      expect(useToolsStore().selectSubMode).toBe('rooms')
    })

    // Otherwise the next `Delete` does something different from what the user
    // last watched themselves select.
    it('clears the selection when the granularity changes', () => {
      const tools = useToolsStore()
      const selection = selectRoom()

      tools.setSelectSubMode('cells')
      expect(selection.isEmpty).toBe(true)
    })

    // A toolbar toggle can re-fire the half already active, and that must not
    // wipe what is selected.
    it('leaves the selection alone when set to the granularity already in use', () => {
      const tools = useToolsStore()
      const selection = selectRoom()

      tools.setSelectSubMode('rooms')
      expect(selection.selected).toHaveLength(1)
    })
  })

  // One flag across modes, not one per mode: the toggle means the same thing
  // in Draw, Door and Markup, so switching between them must not silently
  // disarm it.
  it('keeps the erase toggle across a mode switch', () => {
    const tools = useToolsStore()
    const modeStore = useModeStore()

    tools.toggleErase()
    modeStore.setMode('markup')
    modeStore.setMode('draw')

    expect(tools.erase).toBe(true)
  })

  // Deliberately not persisted: the store declares no `persist` option, which
  // is the whole opt-in. Brush size resets to the default each session rather
  // than being saved as a user pref; the erase toggle follows it because a tool
  // left in a destructive state across restarts is a trap. This assertion
  // catches persistence added later for symmetry with the view toggles.
  it('does not survive a session', () => {
    const tools = useToolsStore()
    tools.toggleErase()
    tools.setBrushSize(5)
    tools.$flushPersist()

    expect(localStorage.length).toBe(0)

    setActivePinia(createTestPinia())
    expect(useToolsStore().erase).toBe(false)
    expect(useToolsStore().brushSize).toBe(1)
  })
})
