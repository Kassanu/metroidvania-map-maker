import { combosForAction, type ActionId } from './keymap'
import type { MessageKey } from '@/i18n'

// Category grouping + display labels are display-only metadata, kept
// separate from keymap.ts so the engine itself has no notion of "category."
// Actions with no bound combo (e.g. 'zenMode', not yet bound) are simply
// omitted below by buildCheatSheet(), not hand-excluded here, so adding a
// binding later doesn't require touching this list.
interface ShortcutCategory {
  labelKey: MessageKey
  actions: ActionId[]
}

const CATEGORIES: ShortcutCategory[] = [
  {
    labelKey: 'cheatSheet.section.modes',
    actions: ['mode.draw', 'mode.select', 'mode.door', 'mode.markup'],
  },
  { labelKey: 'cheatSheet.section.general', actions: ['undo', 'redo', 'save', 'deleteSelection'] },
  {
    labelKey: 'cheatSheet.section.clipboard',
    actions: ['copy', 'cut', 'paste', 'selectAll', 'deselect', 'duplicate'],
  },
  { labelKey: 'cheatSheet.section.drawEdit', actions: ['brushSizeDown', 'brushSizeUp'] },
  { labelKey: 'cheatSheet.section.zoom', actions: ['zoomIn', 'zoomOut', 'zoomReset'] },
  { labelKey: 'cheatSheet.section.help', actions: ['cheatSheet'] },
]

const ACTION_LABEL_KEYS: Record<ActionId, MessageKey> = {
  'mode.draw': 'action.mode.draw',
  'mode.select': 'action.mode.select',
  'mode.door': 'action.mode.door',
  'mode.markup': 'action.mode.markup',
  undo: 'action.undo',
  redo: 'action.redo',
  save: 'action.save',
  deleteSelection: 'action.deleteSelection',
  copy: 'action.copy',
  cut: 'action.cut',
  paste: 'action.paste',
  selectAll: 'action.selectAll',
  deselect: 'action.deselect',
  duplicate: 'action.duplicate',
  brushSizeDown: 'action.brushSizeDown',
  brushSizeUp: 'action.brushSizeUp',
  cheatSheet: 'action.cheatSheet',
  zenMode: 'action.zenMode',
  zoomIn: 'action.zoomIn',
  zoomOut: 'action.zoomOut',
  zoomReset: 'action.zoomReset',
}

export interface CheatSheetRow {
  labelKey: MessageKey
  combos: string[]
}

export interface CheatSheetSection {
  labelKey: MessageKey
  rows: CheatSheetRow[]
}

// Derived from defaultKeymap so the cheat sheet can never drift out of sync
// with the actual engine. No hand-maintained duplicate shortcut list. Rows
// carry message keys; the modal translates them at render time.
export function buildCheatSheet(): CheatSheetSection[] {
  return CATEGORIES.map((category) => ({
    labelKey: category.labelKey,
    rows: category.actions
      .map((actionId) => ({
        labelKey: ACTION_LABEL_KEYS[actionId],
        combos: combosForAction(actionId),
      }))
      .filter((row) => row.combos.length > 0),
  })).filter((section) => section.rows.length > 0)
}
