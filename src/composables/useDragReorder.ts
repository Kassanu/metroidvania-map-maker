import { type Ref } from 'vue'
import { startPointerDrag } from './pointerDrag'
import { DRAG_DEAD_ZONE } from '@/config/constants'

// Drag-to-reorder for a strip of elements. The tab bar goes horizontally, the
// sidebar's panels vertically. Reordering is live (item splices past a neighbour
// when the pointer crosses its midpoint, Chrome/VSCode-tab style), not
// ghost-then-commit. Once tab ops become undoable, only the onReorder callback
// changes.
//
// This is also the single place touch has to be solved (a touch drag here
// currently fights the list's native scroll, and long-press is already taken
// by the context menu) instead of the two divergent places it used to be.

export interface ReorderCandidate {
  index: number
  midpoint: number
}

// The whole decision, as a pure function: where does the pointer sit relative
// to the other items' midpoints? Returns the index to move to, or null to
// leave the order alone. Extracted so it's testable without a DOM. jsdom has
// no layout, so anything reading real rects can't be.
export function crossedReorderIndex(
  pointer: number,
  draggingIndex: number,
  candidates: ReorderCandidate[],
): number | null {
  for (const candidate of candidates) {
    const forward = draggingIndex < candidate.index && pointer > candidate.midpoint
    const backward = draggingIndex > candidate.index && pointer < candidate.midpoint
    if (forward || backward) return candidate.index
  }
  return null
}

// Generic over the id type so a caller with branded ids (the tab bar's are
// core `MapId`s) keeps that type all the way through, instead of the composable
// widening them to `string` and every call site casting them back. Panel ids
// are plain strings and infer as such.
export interface DragReorderOptions<Id extends string> {
  container: Ref<HTMLElement | null>
  axis: 'x' | 'y'
  // The data-* attribute carrying each item's id, without the `data-` prefix
  // (e.g. 'tab-id' for `data-tab-id`).
  dataAttr: string
  // Ids in their current order.
  order: () => Id[]
  onReorder: (id: Id, toIndex: number) => void
  // Veto a press before it can become a drag. A click on a nested control or
  // a press outside the item's designated drag handle.
  shouldStart?: (event: PointerEvent) => boolean
  // See PointerDragOptions.deferCapture: needed wherever the item contains
  // its own clickable controls.
  deferCapture?: boolean
}

export function useDragReorder<Id extends string>(options: DragReorderOptions<Id>) {
  const { container, axis, dataAttr, order, onReorder } = options
  const selector = `[data-${dataAttr}]`

  // The DOM has no types: an id read back off a data attribute is a bare
  // string. It is only ever matched against `order()` before being handed on,
  // so the two casts below are the one place that fact is absorbed, rather
  // than every caller absorbing it.
  const asId = (value: string) => value as Id

  // A completed drag still ends in a synthetic `click` on release; this
  // swallows exactly that one so dropping an item doesn't also activate it.
  let justDragged = false

  function midpointOf(el: HTMLElement): number {
    const rect = el.getBoundingClientRect()
    return axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
  }

  function onPointerDown(event: PointerEvent) {
    if (options.shouldStart && !options.shouldStart(event)) return
    const el = (event.target as HTMLElement).closest<HTMLElement>(selector)
    const raw = el?.getAttribute(`data-${dataAttr}`)
    if (!el || !raw) return
    const id = asId(raw)

    startPointerDrag(event, {
      deadZone: DRAG_DEAD_ZONE,
      deadZoneAxis: axis,
      deferCapture: options.deferCapture,
      resolveTarget: () => el,
      onStart: () => el.classList.add('dragging'),
      onMove: ({ event: current }) => {
        const root = container.value
        if (!root) return
        const ids = order()
        const draggingIndex = ids.indexOf(id)
        if (draggingIndex === -1) return

        const candidates: ReorderCandidate[] = []
        for (const other of root.querySelectorAll<HTMLElement>(selector)) {
          const otherId = other.getAttribute(`data-${dataAttr}`)
          if (!otherId || otherId === id) continue
          const index = ids.indexOf(asId(otherId))
          if (index !== -1) candidates.push({ index, midpoint: midpointOf(other) })
        }

        const pointer = axis === 'x' ? current.clientX : current.clientY
        const toIndex = crossedReorderIndex(pointer, draggingIndex, candidates)
        if (toIndex !== null) onReorder(id, toIndex)
      },
      onEnd: ({ dragged }) => {
        el.classList.remove('dragging')
        justDragged = dragged
      },
    })
  }

  function onClickCapture(event: MouseEvent) {
    if (justDragged) {
      event.stopPropagation()
      justDragged = false
    }
  }

  return { onPointerDown, onClickCapture }
}
