import { describe, it, expect } from 'vitest'
import {
  checkInvariants,
  makeRoom,
  ok,
  refusal,
  rect,
  setup,
  TEST_ICON_COLORS,
  tx,
} from '../testUtils'
import {
  createLine,
  deleteLine,
  extendLine,
  normalizePath,
  peelLine,
  placeIcon,
  repositionIcon,
  setIconColors,
  translateLine,
} from './markup'
import { moveRooms } from './rooms'

const LINE_DEFAULTS = { color: '#ffcc00', arrowStart: false, arrowEnd: true }

describe('icons', () => {
  it('places one inside a room and indexes it by cell', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const transaction = tx(map)
    const icon = ok(placeIcon(transaction, map, '0,0', 'save', TEST_ICON_COLORS))
    expect(icon.cell).toBe('0,0')
    expect(map.iconAtCell.get('0,0')).toBe(icon.id)
  })

  it('refuses a cell outside every room, saying why', () => {
    const { map } = setup()
    const transaction = tx(map)
    expect(refusal(placeIcon(transaction, map, '0,0', 'save', TEST_ICON_COLORS))).toBe(
      'not-in-a-room',
    )
  })

  it('blocks an occupied cell unless replace is on', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const transaction = tx(map)
    const first = ok(placeIcon(transaction, map, '0,0', 'save', TEST_ICON_COLORS))

    // The reason is the one the "replace" checkbox exists to resolve, so the
    // toolbar can act on it rather than just seeing "no".
    expect(refusal(placeIcon(transaction, map, '0,0', 'boss', TEST_ICON_COLORS))).toBe(
      'cell-occupied',
    )

    ok(placeIcon(transaction, map, '0,0', 'boss', TEST_ICON_COLORS, { replace: true }))
    expect(map.icons.has(first.id)).toBe(false)
    expect(map.icons.size).toBe(1)
  })

  it('carries the badge colours it was given, not the icon type', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const transaction = tx(map)

    // Two icons of one type differing in colour is the case that decides the
    // colours live on the object rather than on the registry entry.
    const a = ok(
      placeIcon(transaction, map, '0,0', 'save', { plateColor: '#3b7dd8', glyphColor: '#f5f7fa' }),
    )
    const b = ok(
      placeIcon(transaction, map, '1,0', 'save', { plateColor: '#c94f4f', glyphColor: '#1a1a1a' }),
    )

    expect(a.iconType).toBe(b.iconType)
    expect(a.plateColor).toBe('#3b7dd8')
    expect(b.plateColor).toBe('#c94f4f')
  })

  it('recolours both fills as one undo step', () => {
    const { project, map } = setup()
    makeRoom(project, map, rect(0, 0, 2, 1))
    const place = tx(map)
    const icon = ok(placeIcon(place, map, '0,0', 'save', TEST_ICON_COLORS))
    place.commit()

    const recolour = tx(map)
    setIconColors(recolour, map, icon.id, { plateColor: '#3b7dd8', glyphColor: '#f5f7fa' })
    recolour.commit()
    expect(icon.plateColor).toBe('#3b7dd8')
    expect(icon.glyphColor).toBe('#f5f7fa')

    // Both writes share the transaction, so one undo takes both. Two steps
    // would leave the icon in a pair of colours it was never placed in.
    recolour.replayUndo()
    expect(icon.plateColor).toBe(TEST_ICON_COLORS.plateColor)
    expect(icon.glyphColor).toBe(TEST_ICON_COLORS.glyphColor)
    expect(checkInvariants(project)).toEqual([])
  })

  it('repositions into another room: ownership just follows the cell', () => {
    const { project, map } = setup()
    const a = makeRoom(project, map, rect(0, 0, 1, 1))
    const b = makeRoom(project, map, rect(3, 0, 1, 1))
    const transaction = tx(map)
    const icon = ok(placeIcon(transaction, map, '0,0', 'save', TEST_ICON_COLORS))

    ok(repositionIcon(transaction, map, icon.id, '3,0'))
    expect(map.cellOwner.get(icon.cell)).toBe(b.id)
    expect(map.cellOwner.get('0,0')).toBe(a.id)
  })
})

describe('lines', () => {
  it('needs at least one segment', () => {
    const { map } = setup()
    const transaction = tx(map)
    expect(refusal(createLine(transaction, map, ['0,0'], LINE_DEFAULTS))).toBe('too-short')
    ok(createLine(transaction, map, ['0,0', '1,1'], LINE_DEFAULTS))
  })

  it('may live entirely outside any room', () => {
    const { map } = setup()
    const transaction = tx(map)
    // No rooms exist at all. Lines are an independent overlay.
    ok(createLine(transaction, map, ['0,0', '1,0', '2,0'], LINE_DEFAULTS))
  })

  it('accepts diagonal steps and rejects jumps', () => {
    expect(normalizePath(['0,0', '1,1', '2,2'])).toHaveLength(3)
    expect(normalizePath(['0,0', '5,5'])).toHaveLength(1)
    expect(normalizePath(['0,0', '0,0', '1,0'])).toEqual(['0,0', '1,0'])
  })

  it('extends from either end', () => {
    const { map } = setup()
    const transaction = tx(map)
    const line = ok(createLine(transaction, map, ['1,0', '2,0'], LINE_DEFAULTS))

    extendLine(transaction, map, line.id, false, ['3,0'])
    expect(line.points).toEqual(['1,0', '2,0', '3,0'])

    extendLine(transaction, map, line.id, true, ['0,0'])
    expect(line.points).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('peels from an end and deletes the line once nothing is left', () => {
    const { map } = setup()
    const transaction = tx(map)
    const line = ok(createLine(transaction, map, ['0,0', '1,0', '2,0'], LINE_DEFAULTS))

    peelLine(transaction, map, line.id, false)
    expect(line.points).toEqual(['0,0', '1,0'])

    peelLine(transaction, map, line.id, false)
    expect(map.lines.has(line.id)).toBe(false)
  })

  it('is untouched by room edits: it has no room owner', () => {
    const { project, map } = setup()
    const room = makeRoom(project, map, rect(0, 0, 3, 1))
    const seed = tx(map)
    const line = ok(createLine(seed, map, ['0,0', '1,0', '2,0'], LINE_DEFAULTS))
    seed.commit()

    const transaction = tx(map)
    moveRooms(transaction, project, map, [room.id], 10, 10)
    // The room moved; the line stayed exactly where it was drawn.
    expect(line.points).toEqual(['0,0', '1,0', '2,0'])
  })

  it('translates only when moved as its own selected object', () => {
    const { map } = setup()
    const transaction = tx(map)
    const line = ok(createLine(transaction, map, ['0,0', '1,0'], LINE_DEFAULTS))
    translateLine(transaction, map, line.id, 2, 3)
    expect(line.points).toEqual(['2,3', '3,3'])
  })

  it('deletes', () => {
    const { map } = setup()
    const transaction = tx(map)
    const line = ok(createLine(transaction, map, ['0,0', '1,0'], LINE_DEFAULTS))
    deleteLine(transaction, map, line.id)
    expect(map.lines.size).toBe(0)
  })
})
