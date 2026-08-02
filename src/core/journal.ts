// Transactions and the change journal: both undo and the drag ghost use one
// mechanism. Every mutation goes through a primitive (primitives.ts) that
// records a Change: a pair of closures that apply and un-apply exactly that
// one edit. A Transaction collects them in order.
//
// Undo replays recorded changes backwards. Nothing hand-writes an inverse,
// which matters because cascades are deep: erasing one cell can split a room
// into three, delete inner walls that are no longer interior, and invalidate
// several transitions, all inside one transaction.
//
// The ghost is a transaction that has been applied but not committed. A drag
// opens one; each pointer move calls `reset()` and re-applies the operation
// with the new pointer state. The renderer draws the model as it stands and
// marks `touched` as pending. The preview is the gesture itself, just not
// committed yet. `Esc` calls `rollback()` and the model returns to where it
// started.
//
// Nothing commits mid-drag: nothing enters the undo history, nothing bumps the
// project revision, so no panel, no save, and no dirty-state guard observes
// the speculative state. Only the renderer does.

import { createIdSource } from './ids'
import { ModelError } from './outcome'
import type { IconId, IdSource, LineId, MapId, RoomId, TransitionId } from './ids'
import type { CellKey } from './cell'

export interface Change {
  redo(): void
  undo(): void
}

// What a transaction has affected. The renderer reads this to decide what to
// draw as ghost. `removedRooms` lets the renderer highlight rooms about to be
// destructively absorbed, so that preview comes out for free rather than being
// computed a second way.
export interface TouchSet {
  cells: Set<CellKey>
  rooms: Set<RoomId>
  removedRooms: Set<RoomId>
  transitions: Set<TransitionId>
  removedTransitions: Set<TransitionId>
  icons: Set<IconId>
  removedIcons: Set<IconId>
  lines: Set<LineId>
  removedLines: Set<LineId>
  maps: Set<MapId>
}

export function emptyTouchSet(): TouchSet {
  return {
    cells: new Set(),
    rooms: new Set(),
    removedRooms: new Set(),
    transitions: new Set(),
    removedTransitions: new Set(),
    icons: new Set(),
    removedIcons: new Set(),
    lines: new Set(),
    removedLines: new Set(),
    maps: new Set(),
  }
}

export function isTouchSetEmpty(touched: TouchSet): boolean {
  return (
    touched.cells.size === 0 &&
    touched.rooms.size === 0 &&
    touched.removedRooms.size === 0 &&
    touched.transitions.size === 0 &&
    touched.removedTransitions.size === 0 &&
    touched.icons.size === 0 &&
    touched.removedIcons.size === 0 &&
    touched.lines.size === 0 &&
    touched.removedLines.size === 0 &&
    touched.maps.size === 0
  )
}

// Undo is one global stack for the whole project, so each entry records which
// tab it belongs to. A map-scoped entry makes undo switch to that tab first;
// a project-scoped one reverts everywhere and triggers no tab switch.
export type TransactionScope = { kind: 'project' } | { kind: 'map'; mapId: MapId }

export const PROJECT_SCOPE: TransactionScope = { kind: 'project' }

export type TransactionState = 'open' | 'committed' | 'rolledBack'

export class Transaction {
  readonly label: string
  scope: TransactionScope
  touched: TouchSet = emptyTouchSet()
  // Every id an op creates comes from here rather than from `newRoomId()` and
  // friends directly, so that re-applying the operation reproduces it. See
  // `createIdSource`; `reset()` rewinds it.
  readonly ids: IdSource = createIdSource()

  private changes: Change[] = []
  private state: TransactionState = 'open'
  // Set while replaying, so a stray primitive call during undo/redo is caught
  // rather than silently corrupting the journal.
  private replaying = false

  constructor(label: string, scope: TransactionScope = PROJECT_SCOPE) {
    this.label = label
    this.scope = scope
  }

  get status(): TransactionState {
    return this.state
  }

  get size(): number {
    return this.changes.length
  }

  // True when the transaction did nothing. A resize dragged back to its start,
  // a move dropped on its origin, a paint stroke that changed no cell. These
  // are all no-ops, so commit() drops them rather than putting an empty
  // step on the undo stack.
  get isEmpty(): boolean {
    return this.changes.length === 0
  }

  // Applies the change and keeps it. This is the only way anything enters the
  // journal, which is what guarantees the model and the journal cannot
  // disagree: you cannot mutate without recording, because the primitives do
  // not expose the mutation any other way.
  record(change: Change): void {
    if (this.state !== 'open') {
      throw new ModelError(`cannot record on a ${this.state} transaction`)
    }
    if (this.replaying) {
      throw new ModelError('cannot record a change while replaying the journal')
    }
    change.redo()
    this.changes.push(change)
  }

  // Undo everything recorded so far but stay open and reusable. This is the
  // per-pointer-move half of the ghost: reset, re-apply with the new pointer
  // state, redraw.
  reset(): void {
    if (this.state !== 'open') {
      throw new ModelError(`cannot reset a ${this.state} transaction`)
    }
    this.replayUndo()
    this.changes = []
    this.touched = emptyTouchSet()
    // The point of the ghost is that a re-run *is* the same operation. Objects
    // it creates therefore have to come back with the same ids, or every
    // pointer move hands the gesture layer a new room to hold on to.
    this.ids.rewind()
  }

  // Abort: undo everything and close. Nothing was ever committed, so there is
  // nothing to undo afterwards. This is what `Esc` does mid-gesture.
  rollback(): void {
    if (this.state === 'rolledBack') return
    if (this.state === 'committed') {
      throw new ModelError('cannot roll back a committed transaction; undo it instead')
    }
    this.replayUndo()
    this.changes = []
    this.touched = emptyTouchSet()
    this.state = 'rolledBack'
  }

  // Seals the transaction. The caller (History) decides whether it is worth
  // keeping; a sealed transaction can still be replayed in both directions,
  // which is exactly what the undo stack needs.
  commit(): void {
    if (this.state !== 'open') {
      throw new ModelError(`cannot commit a ${this.state} transaction`)
    }
    this.state = 'committed'
  }

  // Replay, used by the history stack. Deliberately not named undo/redo on the
  // transaction itself so it reads as "move the model", not "add a step".
  replayUndo(): void {
    this.replaying = true
    try {
      for (let i = this.changes.length - 1; i >= 0; i--) this.changes[i].undo()
    } finally {
      this.replaying = false
    }
  }

  replayRedo(): void {
    this.replaying = true
    try {
      for (const change of this.changes) change.redo()
    } finally {
      this.replaying = false
    }
  }

  // Folds another transaction's changes onto the end of this one. Used for
  // coalescing (consecutive tab switches, per B12's deferrable polish) and for
  // batching a multi-selection operation into a single undo step.
  absorb(other: Transaction): void {
    if (this.state !== 'open') {
      throw new ModelError(`cannot absorb into a ${this.state} transaction`)
    }
    // `other` must be open too. Absorbing drains it, so absorbing one the
    // history stack still owns silently hollows out that undo entry: the stack
    // still reports it, and undoing it does nothing at all.
    if (other.status !== 'open') {
      throw new ModelError(`cannot absorb a ${other.status} transaction`)
    }
    this.changes.push(...other.takeChanges())
    mergeTouchSets(this.touched, other.touched)
  }

  private takeChanges(): Change[] {
    const changes = this.changes
    this.changes = []
    return changes
  }
}

function mergeInto<T>(target: Set<T>, source: Set<T>): void {
  for (const value of source) target.add(value)
}

export function mergeTouchSets(target: TouchSet, source: TouchSet): void {
  mergeInto(target.cells, source.cells)
  mergeInto(target.rooms, source.rooms)
  mergeInto(target.removedRooms, source.removedRooms)
  mergeInto(target.transitions, source.transitions)
  mergeInto(target.removedTransitions, source.removedTransitions)
  mergeInto(target.icons, source.icons)
  mergeInto(target.removedIcons, source.removedIcons)
  mergeInto(target.lines, source.lines)
  mergeInto(target.removedLines, source.removedLines)
  mergeInto(target.maps, source.maps)
}
