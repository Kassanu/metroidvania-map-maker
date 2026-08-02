// Which stroke a press starts: the input half of the Draw/Edit precedence
// table, kept apart from the gestures so it can be read as a table.
//
// Secondary click, the pen eraser end, and the toggle each resolve to the
// current mode's erase action; this table puts all three routes in one place:
//
// | Press                                     | Erase toggle off | on    |
// |-------------------------------------------|------------------|-------|
// | primary button                            | paint            | erase |
// | secondary button (right-click/right-drag) | erase            | erase |
// | pen, eraser end                           | erase            | erase |
// | anything else (the middle button)         | n/a              | n/a   |
//
// A pen's barrel button reports as the secondary button, so it lands on the
// right-click row and erases, the same as right-click does in every mode.
//
// The toggle is the universal route and the main one for touch, which has no
// native right-click; the stylus eraser end is a bonus where the browser
// reports it. Right-click stays erase regardless of the toggle: a toggle that
// inverted it would make the mouse's one unambiguous erase gesture mean paint.
//
// Pure and DOM-free on purpose: it takes the two fields it reads rather than an
// event, so the table above is testable without synthesizing pointer events,
// and the component is left with nothing but the dispatch.

import { PEN_ERASER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/composables/pointerDrag'

export type StrokeAction = 'paint' | 'erase'

// `null` = this press starts no stroke. Middle-drag pan lands here: it is not
// implemented yet, and falling through to painting is exactly what must not
// happen in the meantime.
export function strokeActionFor(
  pointer: Pick<PointerEvent, 'button' | 'pointerType'>,
  eraseToggle: boolean,
): StrokeAction | null {
  if (pointer.button === SECONDARY_BUTTON) return 'erase'
  // Guarded on pointerType because button 5 is a side button on a mouse, where
  // it means nothing of the sort.
  if (pointer.button === PEN_ERASER_BUTTON && pointer.pointerType === 'pen') return 'erase'
  if (pointer.button === PRIMARY_BUTTON) return eraseToggle ? 'erase' : 'paint'
  return null
}
