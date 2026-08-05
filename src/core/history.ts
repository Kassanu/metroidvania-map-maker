// The undo stack. One global stack for the whole project, spanning all
// tabs/maps, not a stack per map.
//
// Three consequences of that decision are baked in here:
//
//   * Every entry records its scope. Undoing a map-scoped entry has to put
//     you back on that tab first, so the caller is told which map to activate.
//   * Tab switches are themselves entries. Undo retraces your path including
//     tab context, so you never undo a change on an off-screen tab: undo returns
//     you there as its own step, and the next undo reverts the edit. No
//     "auto-switch and reveal" logic is needed anywhere else.
//   * Consecutive pure-navigation switches coalesce, so idle tab-browsing
//     does not flood the history.

import { Transaction, emptyTouchSet } from './journal'
import type { TouchSet, TransactionScope } from './journal'
import type { MapId } from './ids'
import type { ProjectModel } from './types'

// What the caller must do to the view after a history move: the one piece of
// session state the model cannot own but undo has to drive.
export interface HistoryEffect {
  // Activate this tab before/after applying the change, or null if the step
  // was project-scoped and should not move the user.
  activateMapId: MapId | null
  label: string
  // Exactly what the step touched, so the caller can repaint that and prune
  // selection to it rather than assuming everything changed.
  //
  // `Transaction.touched` survives `commit()` and the entry holds the
  // transaction, so this costs nothing to carry. It describes the change in
  // both directions: a removed room is in `removedRooms` whether the step
  // created it and you undid, or deleted it and you redid.
  touched: TouchSet
}

// A tab switch carries no model change at all; its whole content is the
// activation. It is still a real history entry so undo retraces navigation.
interface Entry {
  transaction: Transaction
  scope: TransactionScope
  // For a navigation entry: where we came from, and where we went.
  navigation?: { from: MapId; to: MapId }
}

// No NAVIGATION_LABEL constant: every op takes its names as parameters, so
// core never holds a copy of what i18n owns. A hardcoded 'Switch tab' would
// render untranslated beside translated labels in the Edit menu.

// A saved position that no entry can ever equal, so `isDirty` stays true down
// to an empty stack.
const NEVER_SAVED = Symbol('never saved')

export class History {
  private readonly project: ProjectModel
  private past: Entry[] = []
  private future: Entry[] = []
  private limit: number
  // The entry that was on top of the stack when the project was last saved, or
  // null if it was saved with an empty history.
  //
  // A stack position, not a revision: `rev` is a monotonic cache key that undo
  // and redo both increment. Comparing it to a saved value would call a project
  // dirty after undoing back to exactly what is on disk, and the
  // close-without-saving prompt would fire when it should not have. Comparing
  // the top entry is exact in both directions: undo back to the saved point is
  // clean, and a different edit from that point is dirty even though the stack
  // depth matches.
  //
  // `NEVER_SAVED` is the third state: a project whose contents exist nowhere
  // but in memory, which `null` cannot express because `null` is also "saved
  // while the history was empty".
  private savedEntry: Entry | null | typeof NEVER_SAVED
  // Set while `applyEffect` is driving the view, so the tab change it causes
  // is not recorded as a fresh navigation.
  private replayingNavigation = false

  constructor(project: ProjectModel, limit = 500) {
    this.project = project
    this.limit = limit
    this.savedEntry = null
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.transaction.label ?? null
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.transaction.label ?? null
  }

  // Dirty is measured against the last entry that changed the model.
  // Navigation entries are real history: undo retraces your path through tabs.
  // But they write nothing to the file, so counting them meant saving, clicking
  // another tab and closing would produce "you have unsaved changes" over a
  // file that matched the disk exactly. A dirty flag must never cry wolf.
  get isDirty(): boolean {
    return this.lastEdit() !== this.savedEntry
  }

  markSaved(): void {
    this.savedEntry = this.lastEdit()
  }

  // The opposite: this project matches no file, and undoing back to an empty
  // stack does not make it match one. A recovered crash snapshot is the case
  // that needs it, since its contents were never written anywhere.
  markNeverSaved(): void {
    this.savedEntry = NEVER_SAVED
  }

  // The top entry that is not a tab switch.
  private lastEdit(): Entry | null {
    for (let i = this.past.length - 1; i >= 0; i--) {
      if (!this.past[i].navigation) return this.past[i]
    }
    return null
  }

  // Opens a transaction. Nothing is on the stack until `commit` is called, so
  // an aborted gesture leaves no trace.
  begin(label: string, scope: TransactionScope): Transaction {
    return new Transaction(label, scope)
  }

  // Commits a transaction onto the stack. An empty one is dropped rather than
  // pushed. A resize dragged back to its start, a move returned to its origin,
  // and a stroke that changed no cell are all no-ops, and a no-op
  // that costs a Ctrl+Z is a bug.
  //
  // Returns the resulting undo step, or null when the transaction was empty.
  // Returning the entry (label, scope, touched) lets the caller drive the view
  // correctly without re-reading the stack. A bare `null` still reads as
  // "nothing happened" at an `if`.
  commit(transaction: Transaction): HistoryEffect | null {
    if (transaction.isEmpty) {
      transaction.rollback()
      return null
    }
    transaction.commit()
    const entry: Entry = { transaction, scope: transaction.scope }
    this.push(entry)
    this.project.rev++
    return this.effectOf(entry, 'redo')
  }

  // Records a tab switch. Consecutive navigation entries collapse into one, so
  // browsing A -> B -> C -> D is a single undo back to A rather than three.
  pushNavigation(from: MapId, to: MapId, label: string): void {
    if (from === to) return
    // A tab switch that undo/redo *caused* is not a new one. See `applyEffect`.
    if (this.replayingNavigation) return

    const top = this.past[this.past.length - 1]
    if (top?.navigation) {
      top.navigation.to = to
      this.future = []
      return
    }

    const transaction = new Transaction(label, { kind: 'map', mapId: to })
    transaction.commit()
    this.push({ transaction, scope: { kind: 'map', mapId: to }, navigation: { from, to } })
  }

  // Performs a history move's view change. Callers must route the effect
  // through here rather than calling their own `activate` directly.
  //
  // The hazard: a tab click calls `pushNavigation`, which records it in
  // history. Undo returns an effect with the old tab id. The store calls
  // `activate` to obey it, which calls `pushNavigation` again, records a new
  // navigation entry, clears redo, and pushes the step just undone back onto
  // the stack. Redo is gone and one undo does nothing.
  //
  // The flag prevents this: a view change that undo caused does not record as
  // a new navigation event.
  applyEffect(effect: HistoryEffect | null, activate: (mapId: MapId) => void): void {
    if (!effect || effect.activateMapId === null) return
    this.replayingNavigation = true
    try {
      activate(effect.activateMapId)
    } finally {
      this.replayingNavigation = false
    }
  }

  undo(): HistoryEffect | null {
    const entry = this.past.pop()
    if (!entry) return null
    entry.transaction.replayUndo()
    this.future.push(entry)
    this.project.rev++
    return this.effectOf(entry, 'undo')
  }

  redo(): HistoryEffect | null {
    const entry = this.future.pop()
    if (!entry) return null
    entry.transaction.replayRedo()
    this.past.push(entry)
    this.project.rev++
    return this.effectOf(entry, 'redo')
  }

  // Starts a fresh history for a new project, opened file, or revert. The
  // saved marker must go with it: it holds an entry that is no longer on the
  // stack. Leaving it set would make a saved project report dirty forever.
  //
  // Clearing always means clean (correct for all three callers), but does not
  // mean unsaved work is safe to discard. The caller must prompt first.
  clear(): void {
    this.past = []
    this.future = []
    this.savedEntry = null
  }

  private push(entry: Entry): void {
    this.past.push(entry)
    // A new edit invalidates the redo branch, as everywhere else.
    this.future = []
    if (this.past.length > this.limit) this.past.shift()
  }

  private effectOf(entry: Entry, direction: 'undo' | 'redo'): HistoryEffect {
    if (entry.navigation) {
      return {
        activateMapId: this.liveMap(
          direction === 'undo' ? entry.navigation.from : entry.navigation.to,
        ),
        label: entry.transaction.label,
        // A tab switch changes no model object.
        touched: emptyTouchSet(),
      }
    }
    return {
      // Project-scoped edits revert everywhere and deliberately do not move
      // the user between tabs.
      activateMapId: entry.scope.kind === 'map' ? this.liveMap(entry.scope.mapId) : null,
      label: entry.transaction.label,
      touched: entry.transaction.touched,
    }
  }

  // A map id is only worth handing back if the map still exists. Redoing a tab
  // deletion returns the entry's scope: the map it just destroyed. An entry
  // recorded before deletion also names the deleted map. Without this check,
  // every caller would need the same guard to avoid activating a missing tab.
  private liveMap(mapId: MapId): MapId | null {
    return this.project.mapsById.has(mapId) ? mapId : null
  }
}
