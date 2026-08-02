import type { ActionId } from './keymap'

// Single handler per action id: these are global singleton concerns (one
// undo stack, one active tab's zoom, etc.), so last-registered-wins is fine.
const handlers = new Map<ActionId, () => void>()

// Returns an unregister function. It only removes the handler if it's still
// the current one for that id, so an unmount race can't clobber a newer
// registration that already replaced it.
export function registerAction(id: ActionId, handler: () => void): () => void {
  handlers.set(id, handler)
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id)
  }
}

export function runAction(id: ActionId): boolean {
  const handler = handlers.get(id)
  if (!handler) return false
  handler()
  return true
}
