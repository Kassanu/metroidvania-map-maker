import { describe, it, expect } from 'vitest'
import { normalizeCombo, isTextEntryTarget, formatCombo } from './combo'

function makeEvent(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('normalizeCombo', () => {
  it('normalizes a plain key with no modifiers', () => {
    expect(normalizeCombo(makeEvent({ key: '1' }))).toBe('1')
  })

  it('treats Ctrl and Cmd as the same "mod" token', () => {
    expect(normalizeCombo(makeEvent({ key: 'z', ctrlKey: true }))).toBe('mod+z')
    expect(normalizeCombo(makeEvent({ key: 'z', metaKey: true }))).toBe('mod+z')
  })

  it('tracks shift explicitly only when mod is held', () => {
    expect(normalizeCombo(makeEvent({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(
      'mod+shift+z',
    )
    expect(normalizeCombo(makeEvent({ key: 'y', ctrlKey: true }))).toBe('mod+y')
  })

  it('does not double-count shift for keys whose value already reflects it', () => {
    expect(normalizeCombo(makeEvent({ key: '?', shiftKey: true }))).toBe('?')
  })

  it('ignores a bare modifier keypress', () => {
    expect(normalizeCombo(makeEvent({ key: 'Control', ctrlKey: true }))).toBe('')
  })

  it('lowercases named keys for a consistent keymap convention', () => {
    expect(normalizeCombo(makeEvent({ key: 'Escape' }))).toBe('escape')
  })
})

describe('formatCombo', () => {
  // The test environment's navigator.userAgent isn't a Mac, so these exercise
  // the Ctrl/Shift/Alt ("+"-joined) branch. The Mac (⌘/⇧/⌥, no "+") branch
  // is a straightforward mirror of the same logic, computed once from
  // navigator.userAgent at module load.
  it('formats a plain key with no modifiers', () => {
    expect(formatCombo('1')).toBe('1')
  })

  it('formats mod as Ctrl and joins with "+"', () => {
    expect(formatCombo('mod+z')).toBe('Ctrl+Z')
  })

  it('formats mod+shift in the fixed mod/alt/shift/key order', () => {
    expect(formatCombo('mod+shift+z')).toBe('Ctrl+Shift+Z')
  })

  it('correctly parses a "+" key without splitting on it (mod++)', () => {
    expect(formatCombo('mod++')).toBe('Ctrl++')
  })

  it('uses friendly labels for named keys', () => {
    expect(formatCombo('escape')).toBe('Esc')
    expect(formatCombo('delete')).toBe('Delete')
  })
})

describe('isTextEntryTarget', () => {
  it('is true for input/textarea/select elements', () => {
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true)
  })

  it('is false for ordinary elements and non-elements', () => {
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
