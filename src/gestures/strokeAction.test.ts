import { describe, it, expect } from 'vitest'
import { strokeActionFor } from './strokeAction'

// There are three ways to erase. This is the whole table, both columns of the
// toggle, in one place: the same discipline as the precedence tables, applied
// to the input side.
describe('strokeActionFor', () => {
  const mouse = (button: number) => ({ button, pointerType: 'mouse' })
  const pen = (button: number) => ({ button, pointerType: 'pen' })
  const touch = (button: number) => ({ button, pointerType: 'touch' })

  describe('with the erase toggle off', () => {
    it('paints on the primary button', () => {
      expect(strokeActionFor(mouse(0), false)).toBe('paint')
    })

    it('erases on the secondary button', () => {
      expect(strokeActionFor(mouse(2), false)).toBe('erase')
    })

    it("erases on a stylus's eraser end", () => {
      expect(strokeActionFor(pen(5), false)).toBe('erase')
    })

    // Touch has no native right-click, which is why the toggle is the main
    // route there. A primary touch press is a paint stroke like any other.
    it('paints on a touch press', () => {
      expect(strokeActionFor(touch(0), false)).toBe('paint')
    })
  })

  describe('with the erase toggle on', () => {
    it('erases on the primary button', () => {
      expect(strokeActionFor(mouse(0), true)).toBe('erase')
    })

    it('erases on a touch press: the universal route', () => {
      expect(strokeActionFor(touch(0), true)).toBe('erase')
    })

    // Not inverted: right-click is the mouse's one unambiguous erase gesture,
    // and a toggle that made it paint would be a trap.
    it('leaves the secondary button erasing rather than inverting it', () => {
      expect(strokeActionFor(mouse(2), true)).toBe('erase')
    })
  })

  describe('presses that start nothing', () => {
    // Middle-drag pan does not exist yet. Until it does, the middle button must
    // stay inert rather than falling through to paint.
    it('ignores the middle button', () => {
      expect(strokeActionFor(mouse(1), false)).toBeNull()
      expect(strokeActionFor(mouse(1), true)).toBeNull()
    })

    // Button 5 on a mouse is a side button and means nothing of the sort, so
    // the eraser route is guarded on pointerType rather than the number alone.
    it('ignores button 5 from anything that is not a pen', () => {
      expect(strokeActionFor(mouse(5), false)).toBeNull()
    })
  })

  // A pen's barrel button reports as the secondary button, so it erases by the
  // same row right-click does: right-click erasing is deliberate across every
  // mode, not an accident of the ordering.
  it('erases on the pen barrel button, which reports as secondary', () => {
    expect(strokeActionFor(pen(2), false)).toBe('erase')
  })
})
