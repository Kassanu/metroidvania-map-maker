import { describe, it, expect } from 'vitest'
import { buildCheatSheet } from './cheatSheet'
import { defaultKeymap } from './keymap'

describe('buildCheatSheet', () => {
  // The derived sections, which is every section but the hand-written gesture
  // one. Split out because the two halves answer to different rules: these are
  // generated from the keymap and must match it exactly, and the gestures
  // below have no keymap entry to match.
  function boundSections() {
    return buildCheatSheet().filter((section) => section.labelKey !== 'cheatSheet.section.gestures')
  }

  it('includes every bound action from the keymap exactly once', () => {
    const allActionIds = new Set(Object.values(defaultKeymap))
    const listedKeys = boundSections().flatMap((section) => section.rows.map((row) => row.labelKey))

    // Every row lists at least one combo, and the total row count matches
    // the number of distinct actions actually bound in the keymap.
    expect(listedKeys.length).toBe(allActionIds.size)
  })

  // Panning is reachable only by holding a key or a mouse button, so it has no
  // keymap entry and nothing derives it. Nothing else in the app announces it
  // either, which is why the exception to "no hand-maintained list" is here.
  it('lists the pan gestures, which are bound to no combo', () => {
    const gestures = buildCheatSheet().find(
      (section) => section.labelKey === 'cheatSheet.section.gestures',
    )

    expect(gestures?.rows.map((row) => row.combos)).toEqual([['Middle-drag'], ['Space+drag']])
  })

  it('keeps the gesture rows out of the keymap, where they would be claimed', () => {
    const combos = Object.keys(defaultKeymap)
    expect(combos).not.toContain('space')
    expect(combos).not.toContain(' ')
  })

  it('groups multiple combos for the same action onto one row (e.g. redo)', () => {
    const sections = buildCheatSheet()
    const generalSection = sections.find((s) => s.labelKey === 'cheatSheet.section.general')
    const redoRow = generalSection?.rows.find((r) => r.labelKey === 'action.redo')

    expect(redoRow?.combos).toEqual(expect.arrayContaining(['mod+shift+z', 'mod+y']))
    expect(redoRow?.combos).toHaveLength(2)
  })

  it('omits unbound actions (e.g. zenMode, which has no assigned key yet)', () => {
    const sections = buildCheatSheet()
    const allKeys = sections.flatMap((section) => section.rows.map((row) => row.labelKey))
    expect(allKeys).not.toContain('action.zenMode')
  })

  it('lists both "?" and "/" for the cheat sheet action (Firefox Quick Find workaround)', () => {
    const sections = buildCheatSheet()
    const helpSection = sections.find((s) => s.labelKey === 'cheatSheet.section.help')
    const cheatSheetRow = helpSection?.rows.find((r) => r.labelKey === 'action.cheatSheet')

    expect(cheatSheetRow?.combos).toEqual(expect.arrayContaining(['?', '/']))
  })

  it('omits any section that would otherwise be empty', () => {
    const sections = buildCheatSheet()
    for (const section of sections) {
      expect(section.rows.length).toBeGreaterThan(0)
    }
  })
})
