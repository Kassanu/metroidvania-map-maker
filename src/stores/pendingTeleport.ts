// The teleport gesture's half-finished state: the first UI state in the app
// that is neither a gesture nor a transaction.
//
// Pending is a transient UI state, not a model change. After the first click
// the origin endpoint shows a marker and a "pick a destination" prompt.
// Nothing is committed and nothing is on the undo stack yet. Everything else
// in this file follows from that.
//
// Why a store and not a gesture. Every other multi-step canvas interaction
// is a `GhostGesture`: one open transaction, speculative apply, commit on
// release. This one cannot be. It holds no transaction, because there is nothing
// to apply: half a teleport is not a smaller teleport, it is nothing at all.
// It outlives the pointer that started it, because "you may switch and
// create tabs freely while pending". A gesture that survives a tab switch and
// applies nothing is not a gesture; it is a slot of the same shape as
// `drawArea`, and like it, it prunes.
//
// Why it prunes. The origin names a map and a cell that can both go away
// under it: the tab is closed, the room is erased, an undo removes it, a file
// is opened over the top. Losing either cancels the pending teleport. The
// argument against doing that at each of those call sites is the one the
// selection store already makes: it is the version that eventually misses one.
//
// Why the mode watch is here rather than in the canvas. Cancellation happens
// only via `Esc`, switching modes (leaving Door mode), or deleting the origin's
// tab or room. Two of those three are model facts, and the third is a mode fact.
// None of them is a canvas fact. Owning all three here makes "pending only
// exists in Door mode" a property of the state itself, true whatever is mounted.
// The one cancel route that is genuinely input, `Esc`, stays with the component
// that owns input wiring, exactly as the active room's does.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useModelStore, mapScope } from './model'
import { useModeStore } from './mode'
import { useDoorDefaultsStore } from './doorDefaults'
import { canCompleteTeleport, createTeleport, hasTeleportAt } from '@/core/ops/doors'
import { wasRefused } from '@/core/outcome'
import { t } from '@/i18n'
import type { MapId } from '@/core/ids'
import type { CellKey } from '@/core/cell'

export const usePendingTeleportStore = defineStore('pendingTeleport', () => {
  const model = useModelStore()
  const mode = useModeStore()
  const doorDefaults = useDoorDefaultsStore()

  // Tagged with its map for the same reason the active room is: there is only
  // ever one, and an origin on another map must not draw a marker on this one.
  // Unlike the active room, it deliberately does not store a `roomId`: the
  // project-wide rule is that connected rooms are derived from the cells, and
  // storing one here would mean a room merged under the pending origin left it
  // pointing at a room that no longer exists while its cell was still perfectly
  // good.
  const origin = ref<{ mapId: MapId; cell: CellKey } | null>(null)

  function start(mapId: MapId, cell: CellKey): void {
    origin.value = { mapId, cell }
  }

  function cancel(): void {
    origin.value = null
  }

  // The second click. Returns `void`, and that is the return convention doing
  // its job rather than laziness: the caller can do nothing about a refusal,
  // because an invalid second click is ignored and the gesture stays pending
  // (uniform on the origin tab and any other tab; a misclick never forces a
  // restart). A boolean would invite a caller to invent a reaction that should
  // not exist.
  //
  // Every refusal route lands here identically: an empty cell and a cell in the
  // origin's own room are `teleportRefusal`'s two reasons, and a cell that
  // already holds a teleport is `teleport-exists`. That last one is invalid for
  // the same reason and must behave the same way.
  // Nothing is committed either way: a refused `createTeleport` records no change,
  // so the transaction is empty and the seam drops it rather than putting a no-op
  // step on the undo stack.
  function complete(mapId: MapId, cell: CellKey): void {
    const from = origin.value
    if (!from) return
    // The origin map going missing is pruned below, so this cannot normally
    // happen, but `createTeleport` throws on an unknown origin map rather
    // than refusing, and a thrown error inside a click handler is a worse
    // failure than a click that does nothing.
    if (!model.project.mapsById.has(from.mapId)) return cancel()

    // Scoped to the map that stores it, which for a cross-tab teleport is the
    // origin's. That is what makes the single `Ctrl+Z` land somewhere coherent:
    // a map-scoped undo switches to that tab first, so undoing a cross-tab
    // teleport takes you to the end you started from.
    const created = model.run(t('history.addTeleport'), mapScope(from.mapId), (tx) =>
      createTeleport(tx, model.project, from, { mapId, cell }, doorDefaults.options),
    )
    if (wasRefused(created)) return
    origin.value = null
  }

  // The pending origin on `mapId`, or null when the pending origin belongs to
  // another map or when nothing is pending. Same shape as the selection's
  // `soleRoomOn`, and for the same reason: the canvas asks "is anything pending
  // here" without this store knowing which tab is on screen.
  function originOn(mapId: MapId): CellKey | null {
    const current = origin.value
    return current && current.mapId === mapId ? current.cell : null
  }

  // Whether a click here would complete rather than be ignored: the cursor's
  // question, and the only reason this is separate from `complete` above.
  //
  // It is deliberately the whole acceptance test, not just `canCompleteTeleport`:
  // that one answers two of the refusals (not in a room, same room as the
  // origin) and knows nothing about the third, at most one teleport per cell.
  // A cursor that promised a destination `createTeleport` then refused would be
  // the same false promise the mode-gated cursors exist to avoid.
  function canCompleteAt(mapId: MapId, cell: CellKey): boolean {
    const from = origin.value
    if (!from) return false
    if (hasTeleportAt(model.project, mapId, cell)) return false
    return canCompleteTeleport(model.project, from, { mapId, cell })
  }

  // The origin can outlive the cell it names. Two ways, and they need one check
  // each: the whole map is gone (the tab was closed, or undo removed it), or the
  // cell is no longer in a room (the room was erased, resized away, or absorbed
  // by a merge).
  //
  // Watches `rev`, not `structureRev`: a room being erased is map content, and
  // `structureRev` would sleep through it. Closing a tab moves both.
  function prune(): void {
    const current = origin.value
    if (!current) return
    const map = model.project.mapsById.get(current.mapId)
    if (!map || !map.cellOwner.has(current.cell)) origin.value = null
  }

  // `flush: 'sync'` for the reason the other two slots give: this is input
  // state, and a click can follow the deleting one immediately. Nothing should
  // be able to read an origin whose room has already gone.
  watch([() => model.project, () => model.rev], prune, { flush: 'sync' })

  // Leaving Door mode cancels. Sync for the same reason: the mode keys are a
  // keypress away from the next click.
  watch(
    () => mode.active,
    (active) => {
      if (active !== 'door') cancel()
    },
    { flush: 'sync' },
  )

  return {
    start,
    cancel,
    complete,
    originOn: computed(() => originOn),
    canCompleteAt: computed(() => canCompleteAt),
    // Whether anything is pending at all: for the prompt, and for the `Esc`
    // tier, which must only be registered while there is something for it to
    // cancel or it would swallow a keypress that should have fallen through.
    isPending: computed(() => origin.value !== null),
  }
})
