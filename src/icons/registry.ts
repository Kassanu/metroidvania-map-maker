import { PLATE_ROUNDED_SQUARE, type IconArt } from '@/canvas/iconBadge'
import type { IconColors } from '@/core/ops/markup'

// Icon identity, in one place: id, what it is called, how it is found, what it
// draws as and the colours it arrives with. The picker grid, its search and the
// renderer's art catalogue are all derived from `ICONS`, so adding an icon means
// adding one entry here and nothing else.
//
// Lives outside stores/ by design: this is configuration, not reactive state.
//
// `id` is the value stored in `IconObject.iconType`, so it is the save-file
// format. Renaming one orphans every saved icon of that type. Ids are flat
// kebab-case and never contain a colon, which is reserved for user-supplied
// icons; `category` is separate from the id so recategorising costs nothing.
//
// `name` and `keywords` are plain strings rather than message keys. A set this
// size would otherwise put a hundred entries into every locale, and adding an
// icon would stop being one entry in one file.

export type IconCategory = 'poi' | 'item' | 'enemy' | 'letter' | 'digit' | 'symbol'

export interface IconRegistryEntry {
  id: string
  name: string
  // Extra search terms, for when the name is not what the user would type.
  keywords: string[]
  category: IconCategory
  // SVG path data in the badge viewBox. A sub-path wound against its enclosing
  // shape cuts a hole, which is how a two-tone glyph shows the plate through.
  glyph: string
  // Omitted unless the icon needs a plate that is not the standard square.
  plate?: string
  // What the toolbar's swatches load when this icon is armed.
  defaultColors: IconColors
}

export const ICONS: IconRegistryEntry[] = [
  {
    id: 'save',
    name: 'Save',
    keywords: ['floppy', 'disk', 'checkpoint', 'station'],
    category: 'poi',
    glyph: 'M4 4 H15 L20 9 V20 H4 Z M9 5 V10 H15 V5 Z M8 14 V19 H16 V14 Z',
    defaultColors: { plateColor: '#3b7dd8', glyphColor: '#f5f7fa' },
  },
  {
    id: 'missile',
    name: 'Missile',
    keywords: ['rocket', 'ammo', 'expansion', 'tank'],
    category: 'item',
    glyph: 'M12 2 L16 9 V18 H8 V9 Z M8 13 L8 19 H5 Z M16 13 L19 19 H16 Z',
    defaultColors: { plateColor: '#c94f4f', glyphColor: '#f7ecec' },
  },
]

export function getIcon(id: string): IconRegistryEntry | undefined {
  return ICONS.find((entry) => entry.id === id)
}

export function listIcons(): readonly IconRegistryEntry[] {
  return ICONS
}

// Matches the name, the keywords and the id, so a user who knows what the thing
// is called in the save file finds it too. A blank query is every icon, which
// is what an unfiltered grid wants.
export function searchIcons(query: string): readonly IconRegistryEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return ICONS
  return ICONS.filter(
    (entry) =>
      entry.id.includes(needle) ||
      entry.name.toLowerCase().includes(needle) ||
      entry.keywords.some((keyword) => keyword.includes(needle)),
  )
}

// Resolved art by id, for handing to the renderer through the scene. Built once
// and shared: the renderer holds no registry of its own, so this is the whole
// of what it knows about icon types.
const ART: ReadonlyMap<string, IconArt> = new Map(
  ICONS.map((entry) => [
    entry.id,
    { plate: entry.plate ?? PLATE_ROUNDED_SQUARE, glyph: entry.glyph },
  ]),
)

export function iconArtCatalogue(): ReadonlyMap<string, IconArt> {
  return ART
}
