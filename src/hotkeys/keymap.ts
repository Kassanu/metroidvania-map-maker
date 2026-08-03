// All action ids. Most have no registered handler yet (see actions.ts). The
// keymap is populated fully now so future features only need a
// registerAction()/useHotkeyAction() call, never a keymap edit.
export type ActionId =
  | 'mode.draw'
  | 'mode.select'
  | 'mode.door'
  | 'mode.markup'
  | 'undo'
  | 'redo'
  | 'save'
  | 'deleteSelection'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'selectAll'
  // Bound to nothing. `Esc` already clears the selection through the Esc
  // precedence stack, where it sits below any live gesture; a combo here would
  // be a second route that skips that ordering. It exists as an id so the menu
  // item can run it.
  | 'deselect'
  | 'duplicate'
  | 'brushSizeUp'
  | 'brushSizeDown'
  | 'cheatSheet'
  | 'zenMode'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

// combo -> action. Escape is deliberately absent. It resolves through the
// Esc precedence stack (escStack.ts), not a fixed action. Zen mode's key is
// not yet assigned, so 'zenMode' has no binding yet even though the action
// id exists.
export const defaultKeymap: Record<string, ActionId> = {
  '1': 'mode.draw',
  '2': 'mode.select',
  '3': 'mode.door',
  '4': 'mode.markup',

  'mod+z': 'undo',
  'mod+shift+z': 'redo',
  'mod+y': 'redo',
  'mod+s': 'save',
  delete: 'deleteSelection',
  backspace: 'deleteSelection',

  'mod+c': 'copy',
  'mod+x': 'cut',
  'mod+v': 'paste',
  'mod+a': 'selectAll',
  'mod+d': 'duplicate',

  '[': 'brushSizeDown',
  ']': 'brushSizeUp',

  // Firefox's Quick Find is bound to the physical "/" key and doesn't
  // reliably respect our preventDefault() for it. It reportedly still fires
  // even when Shift+/ ("?") is what's actually pressed. Binding plain "/" too
  // means whichever value we actually receive still matches.
  '?': 'cheatSheet',
  '/': 'cheatSheet',

  // Mirrors how browsers bind their own zoom shortcuts. Covers both the
  // unshifted "=" (Ctrl+= is the common real-world chord) and an explicit
  // "+" (e.g. numpad), since which one `event.key` reports for Ctrl+Plus
  // varies by keyboard.
  'mod+=': 'zoomIn',
  'mod++': 'zoomIn',
  'mod+-': 'zoomOut',
  'mod+0': 'zoomReset',
}

// Every combo bound to an action, in keymap order. The keymap is the single
// source of truth for bindings, so anything that displays a shortcut (the
// cheat sheet, the mode-button tooltips) derives it from here rather than
// keeping its own copy to drift out of sync.
export function combosForAction(actionId: ActionId): string[] {
  return Object.entries(defaultKeymap)
    .filter(([, id]) => id === actionId)
    .map(([combo]) => combo)
}
