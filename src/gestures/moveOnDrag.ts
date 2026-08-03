// A drag that begins on a selected object moves it. A drag that begins anywhere
// else does the mode's normal thing.
//
// A default, not an invariant, and the exemptions are the rule rather than
// special cases: a mode's drag column is spent on whatever that mode authors,
// and this applies only where it is free.
//
//   Draw    paint / grow / merge / erase / edge-run resize / inner-wall vertex
//   Door    the box, from any room cell including one holding a transition
//   Markup  line-end extends, line-body draws; free for a selected line body
//   Select  free, having no create column at all
//
// So Draw and Door never call this, and that is not an oversight to tidy up
// later. Pressing a room cell in Draw selects it, so hoisting the check above
// the mode dispatch would turn every paint stroke after the first into a room
// move, and Door's box would refuse to start from a cell whose transition is
// selected. The modes that honour the default call it themselves.

import { useSelectionStore } from '@/stores/selection'
import type { ObjectRef } from '@/core/types'

export function movesOnDrag(ref: ObjectRef | null): boolean {
  if (!ref) return false
  return useSelectionStore().isSelected(ref)
}
