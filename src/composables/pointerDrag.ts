// The one pointer-drag primitive: capture, pointermove/up/cancel, cleanup.
// Every chrome gesture (sidebar width, panel height, drag-reorders) and canvas
// gestures use it. The shape canvas needs is a superset of the basic flow, so
// extra features (cell-boundary triggers, long-press, two-finger hand-offs)
// belong here as further options rather than as parallel implementations.
//
// Deliberately a per-gesture function, not a setup-time `use*` composable.
// It's called from inside a pointerdown handler, so everything a gesture needs
// (the values captured at press time) stays in one closure instead of being
// hoisted into module-level refs.

// Pointer Events button numbers, named here because this is where a press is
// first classified. `button` is only meaningful on the down/up events. A
// pointermove reports -1, so every gesture decides what it is at press time
// and never re-reads it.
export const PRIMARY_BUTTON = 0
export const MIDDLE_BUTTON = 1
export const SECONDARY_BUTTON = 2
// The eraser end of a stylus. Reported alongside pointerType 'pen', and only
// where the browser bothers (Chromium solid, elsewhere spotty). The erase
// toggle is the robust route and this one is a bonus.
export const PEN_ERASER_BUTTON = 5

export interface DragContext {
  event: PointerEvent
  target: HTMLElement
  startX: number
  startY: number
  // Travel since the press, in px.
  dx: number
  dy: number
}

export interface PointerDragOptions {
  // Travel required before the press counts as a drag. 0 (the default) means
  // the first pointermove confirms it. Right for resize handles, where
  // there's no competing click to protect.
  deadZone?: number
  // Which travel the dead zone measures. A tab drag shouldn't be confirmed
  // by vertical wander, and vice versa.
  deadZoneAxis?: 'x' | 'y' | 'both'
  // Hold off setPointerCapture until the drag is confirmed. Capturing at
  // press time retargets the eventual synthetic `click` to the captured
  // element, which breaks nested buttons for plain (non-drag) presses.
  deferCapture?: boolean
  // The element to capture on and listen to. Defaults to the element the
  // pointerdown handler is bound to.
  resolveTarget?: (event: PointerEvent) => HTMLElement | null
  // Pointer buttons that trigger the gesture. Defaults to primary (used by
  // all chrome gestures). Canvas passes additional buttons for right-drag and
  // stylus eraser strokes, which need tracking like left-drag paint.
  buttons?: readonly number[]
  // Fires once, when the press becomes a drag.
  onStart?: (context: DragContext) => void
  onMove?: (context: DragContext) => void
  // Always fires on release, drag or not, so callers can clean up
  // unconditionally. `dragged` says which it was.
  onEnd?: (context: DragContext & { dragged: boolean }) => void
}

function travelled(dx: number, dy: number, axis: 'x' | 'y' | 'both'): number {
  if (axis === 'x') return Math.abs(dx)
  if (axis === 'y') return Math.abs(dy)
  return Math.max(Math.abs(dx), Math.abs(dy))
}

// Returns true if the press was accepted (a drag may follow), false if it was
// ignored. A button this gesture does not take or no resolvable target.
export function startPointerDrag(event: PointerEvent, options: PointerDragOptions = {}): boolean {
  const {
    deadZone = 0,
    deadZoneAxis = 'both',
    deferCapture = false,
    buttons = [PRIMARY_BUTTON],
    resolveTarget = (e: PointerEvent) => e.currentTarget as HTMLElement | null,
  } = options

  if (!buttons.includes(event.button)) return false
  const target = resolveTarget(event)
  if (!target) return false

  const startX = event.clientX
  const startY = event.clientY
  let dragging = false

  function context(current: PointerEvent): DragContext {
    return {
      event: current,
      target: target as HTMLElement,
      startX,
      startY,
      dx: current.clientX - startX,
      dy: current.clientY - startY,
    }
  }

  function onMove(current: PointerEvent) {
    const ctx = context(current)
    if (!dragging) {
      if (travelled(ctx.dx, ctx.dy, deadZoneAxis) < deadZone) return
      dragging = true
      if (deferCapture) target!.setPointerCapture(current.pointerId)
      options.onStart?.(ctx)
    }
    options.onMove?.(ctx)
  }

  function onEnd(current: PointerEvent) {
    target!.removeEventListener('pointermove', onMove)
    options.onEnd?.({ ...context(current), dragged: dragging })
  }

  if (!deferCapture) target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onEnd, { once: true })
  target.addEventListener('pointercancel', onEnd, { once: true })
  return true
}
