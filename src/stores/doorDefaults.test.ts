import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { useDoorDefaultsStore } from './doorDefaults'
import { PROJECT_SCOPE, useModelStore } from './model'
import { createNewLockType, deleteLockType } from '@/core/ops/project'
import { OPEN_LOCK_ID } from '@/core/ids'
import type { LockTypeId } from '@/core/ids'

// What the next transition gets, and nothing else. The two rules this file
// holds down are both negative: it never reads the selection and never writes
// to it. So most of what is testable here is the third thing: it must never
// hand a creation op a lock type that is not there.

describe('doorDefaults store', () => {
  beforeEach(() => {
    setActivePinia(createTestPinia())
  })

  function addLock(name: string): LockTypeId {
    const model = useModelStore()
    return model.run('Add Lock', PROJECT_SCOPE, (tx) => createNewLockType(tx, model.project, name))
      .id
  }

  // `Open` is the default and the fallback, and safe as both because it is
  // immutable: there is always something to fall back to.
  it('starts on Open, two-way', () => {
    const defaults = useDoorDefaultsStore()
    expect(defaults.lockTypeId).toBe(OPEN_LOCK_ID)
    expect(defaults.oneWay).toBe(false)
    expect(defaults.options).toEqual({ lockTypeId: OPEN_LOCK_ID, oneWay: false })
  })

  it('carries whatever was picked into the next transition', () => {
    const defaults = useDoorDefaultsStore()
    const missile = addLock('Missile Door')

    defaults.selectLock(missile)
    defaults.setOneWay(true)

    expect(defaults.options).toEqual({ lockTypeId: missile, oneWay: true })
  })

  describe('pruning', () => {
    // Same argument as the area picker's: having every op that can destroy a
    // lock type also clear this is the version that eventually misses one.
    it('falls back to Open when the chosen lock type is deleted', () => {
      const model = useModelStore()
      const defaults = useDoorDefaultsStore()
      const missile = addLock('Missile Door')
      defaults.selectLock(missile)

      model.run('Delete Lock', PROJECT_SCOPE, (tx) => deleteLockType(tx, model.project, missile))

      expect(defaults.lockTypeId).toBe(OPEN_LOCK_ID)
    })

    // The half a guard alone would not give: pruning is one-way, so a lock type
    // the user watched disappear does not silently come back selected when an
    // undo restores it.
    it('does not re-select a lock type that undo brings back', () => {
      const model = useModelStore()
      const defaults = useDoorDefaultsStore()
      const missile = addLock('Missile Door')
      defaults.selectLock(missile)

      model.run('Delete Lock', PROJECT_SCOPE, (tx) => deleteLockType(tx, model.project, missile))
      model.undo()

      expect(model.project.lockTypes.has(missile)).toBe(true)
      expect(defaults.lockTypeId).toBe(OPEN_LOCK_ID)
    })

    // The half the watcher structurally cannot see: a `selectLock` handed an id
    // that was already unknown changes no structure, so nothing wakes the
    // watcher. Without the guard on read, a creation op would mint a transition
    // pointing at a lock type that is not there.
    it('never reports a lock type the project does not have', () => {
      const defaults = useDoorDefaultsStore()

      defaults.selectLock('lock_never_existed' as LockTypeId)

      expect(defaults.options.lockTypeId).toBe(OPEN_LOCK_ID)
    })
  })
})
