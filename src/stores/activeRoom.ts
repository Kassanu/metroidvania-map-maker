// Draw/Edit's active room: the room currently showing handles.
//
// Deliberately separate from `stores/selection.ts`. The active room only
// governs which room shows handles; it is not a selection.
//
// It arms on pointer-down, not on click. Pressing a room cell arms it even
// when the press goes on to become a paint stroke. There is no canvas deselect:
// the active room is whatever you last touched or edited, and pressing empty
// grid does not clear it. Clearing is off-canvas only, through Esc or the
// Hierarchy once that exists. It is exactly one room, never a list and never
// another kind of object, which is why this is a single slot where a selection
// is `ObjectRef[]`.
//
// The two hover-dependent actions (resize, inner walls) work without a hover:
// essential for touch parity. The pattern is tap to arm, then drag the visible
// handle. Also a precision aid on desktop.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModelStore } from './model'
import type { MapId, RoomId } from '@/core/ids'

export const useActiveRoomStore = defineStore('activeRoom', () => {
  const model = useModelStore()

  // Tagged with its map rather than kept per-tab, because there is only ever
  // one: handles are drawn for the tab you are looking at, and an active room
  // on another map must not draw on this one. Storing the pair lets the canvas
  // ask "is anything active here" without the store knowing which tab is on
  // screen.
  const active = ref<{ mapId: MapId; roomId: RoomId } | null>(null)

  function arm(mapId: MapId, roomId: RoomId): void {
    active.value = { mapId, roomId }
  }

  function clear(): void {
    active.value = null
  }

  // The active room on `mapId`, or null if the active room belongs to another
  // map or to none.
  function roomIdOn(mapId: MapId): RoomId | null {
    const current = active.value
    return current && current.mapId === mapId ? current.roomId : null
  }

  // The active room can outlive the room it points at: a merge absorbs it, an
  // erase splits it away, undo removes it, a file is opened. Clearing it from
  // every op that can destroy a room is the version that eventually misses one,
  // so this clears it after any committed change instead.
  //
  // Runs on `rev` rather than `structureRev`, because deleting a room is map
  // content and `structureRev` would not move.
  function prune(): void {
    const current = active.value
    if (!current) return
    const map = model.project.mapsById.get(current.mapId)
    if (!map || !map.rooms.has(current.roomId)) active.value = null
  }

  watch([() => model.project, () => model.rev], prune, { flush: 'sync' })

  return {
    arm,
    clear,
    roomIdOn: computed(() => roomIdOn),
    // Whether anything is armed at all. The Esc tier must only be registered
    // while there is something for it to clear, or it would swallow a keypress
    // that should have fallen through.
    isArmed: computed(() => active.value !== null),
  }
})
