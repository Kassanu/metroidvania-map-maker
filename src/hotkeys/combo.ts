// Canonical string form of a keydown combo. "mod" covers both Ctrl and Cmd,
// so one keymap works cross-platform without a separate Mac variant. Mac
// users get Cmd where everyone else uses Ctrl.
//
// Shift is only tracked as its own token when `mod` is also held. Without a
// modifier, `event.key` already reflects the shifted character (e.g. "?" for
// Shift+/), so adding our own "shift" token there would double-count it.
// With `mod` held, we can't rely on that the same way (undo vs. redo must be
// distinguished reliably), so we lowercase the key and track shift ourselves.
const BARE_MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt'])

export function normalizeCombo(event: KeyboardEvent): string {
  if (BARE_MODIFIER_KEYS.has(event.key)) return ''

  const hasMod = event.ctrlKey || event.metaKey
  const parts: string[] = []

  if (hasMod) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (hasMod && event.shiftKey) parts.push('shift')

  parts.push(event.key.toLowerCase())
  return parts.join('+')
}

// True for any element where typing should be treated as text entry, not a
// shortcut: inline renames, inspector fields, search boxes, dialog inputs.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

// Display formatting for the cheat sheet (separate concern from matching
// above). normalizeCombo() always builds combos in a fixed order (mod, then
// alt, then shift, then the key), so we can parse by stripping known prefixes
// positionally rather than splitting on "+". Splitting would break for combos
// where the key itself IS "+" (e.g. "mod++" for zoom in).
interface ParsedCombo {
  mod: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseCombo(combo: string): ParsedCombo {
  let rest = combo
  const mod = rest.startsWith('mod+')
  if (mod) rest = rest.slice(4)
  const alt = rest.startsWith('alt+')
  if (alt) rest = rest.slice(4)
  const shift = rest.startsWith('shift+')
  if (shift) rest = rest.slice(6)
  return { mod, alt, shift, key: rest }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

const KEY_LABELS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  delete: 'Delete',
  backspace: 'Backspace',
  ' ': 'Space',
}

function formatKey(key: string): string {
  if (key in KEY_LABELS) return KEY_LABELS[key]
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)
}

// Human-readable display string for a combo: "Ctrl+Shift+Z" on Windows/Linux,
// "⌘⇧Z" on Mac (platform-detected purely for display; the underlying "mod"
// matching is already unified per normalizeCombo above).
export function formatCombo(combo: string): string {
  const { mod, alt, shift, key } = parseCombo(combo)
  const parts: string[] = []
  if (mod) parts.push(isMac ? '⌘' : 'Ctrl')
  if (alt) parts.push(isMac ? '⌥' : 'Alt')
  if (shift) parts.push(isMac ? '⇧' : 'Shift')
  parts.push(formatKey(key))
  return parts.join(isMac ? '' : '+')
}
