// Esc precedence stack, tiers 2-5: dialog, gesture, armedIcon, selection.
// Tier 1 (focused text field) isn't here. The dispatcher steps aside entirely
// when a text field is focused, deferring to that field's own local Escape
// handling (see useHotkeys.ts). Tier 6 (no-op) is nothing registered.
export type EscTier = 'dialog' | 'gesture' | 'armedIcon' | 'selection'

const ESC_TIERS: EscTier[] = ['dialog', 'gesture', 'armedIcon', 'selection']

const stacks: Record<EscTier, Array<() => void>> = {
  dialog: [],
  gesture: [],
  armedIcon: [],
  selection: [],
}

// Returns a pop function. Handlers are expected to manage their own lifecycle
// (e.g. a dialog closing itself unregisters via this on unmount). resolveEscape()
// only calls the top handler, it doesn't remove it.
export function pushEscHandler(tier: EscTier, handler: () => void): () => void {
  stacks[tier].push(handler)
  return () => {
    const stack = stacks[tier]
    const index = stack.indexOf(handler)
    if (index !== -1) stack.splice(index, 1)
  }
}

// Calls the most-recently-pushed handler in the highest-priority non-empty
// tier. Returns false if nothing is registered anywhere (the no-op tier).
export function resolveEscape(): boolean {
  for (const tier of ESC_TIERS) {
    const stack = stacks[tier]
    const top = stack[stack.length - 1]
    if (top) {
      top()
      return true
    }
  }
  return false
}
