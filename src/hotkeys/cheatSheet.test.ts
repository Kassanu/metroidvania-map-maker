import { describe, it, expect } from 'vitest'
import { buildCheatSheet } from './cheatSheet'
import { defaultKeymap } from './keymap'

describe('buildCheatSheet', () => {
  it('includes every bound action from the keymap exactly once', () => {
    const sections = buildCheatSheet()
    const allActionIds = new Set(Object.values(defaultKeymap))
    const listedKeys = sections.flatMap((section) => section.rows.map((row) => row.labelKey))

    // Every row lists at least one combo, and the total row count matches
    // the number of distinct actions actually bound in the keymap.
    expect(listedKeys.length).toBe(allActionIds.size)
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
