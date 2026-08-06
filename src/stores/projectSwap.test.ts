import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia } from 'pinia'
import { createTestPinia } from '@/test-setup'
import { setStorageProvider } from '@/storage'
import type { OpenedProject, StorageProvider } from '@/storage'
import { toJSON } from '@/core/serialize'
import { createProject } from '@/core/factory'
import { createNewArea, createNewLockType } from '@/core/ops/project'
import { paintCells } from '@/core/ops/rooms'
import { addMap } from '@/core/ops/maps'
import { rect, tx } from '@/core/testUtils'
import { WORLD_AREA_ID } from '@/core/ids'
import type { AreaId, LockTypeId } from '@/core/ids'
import { copySelection } from '@/core/ops/clipboard'
import { useModelStore } from './model'
import { useFileStore } from './file'
import { useSelectionStore } from './selection'
import { useClipboardStore } from './clipboard'
import { useDrawAreaStore } from './drawArea'
import { useDoorDefaultsStore } from './doorDefaults'
import { useTabsStore } from './tabs'

// Opening a project replaces everything the model holds, and every store that
// caches an id from it has to notice. An id that outlives its project is not a
// stale label: it is a `LockTypeId` no lock has, an `AreaId` no area has, and a
// clipboard whose contents point at rooms that no longer exist.
//
// Every store here is checked against the project that is actually loaded,
// rather than against a constant, so a store that resets to the wrong thing
// fails as loudly as one that does not reset at all.

// Two projects with nothing in common but their guaranteed fallbacks.
function projectNamed(name: string) {
  const project = createProject({
    projectName: name,
    firstMapName: `${name} Map`,
    worldAreaName: 'World',
    openLockName: 'Open',
    lockedLockName: 'Locked',
  })
  const map = project.mapsById.get(project.maps[0])!

  const setup = tx()
  const area = createNewArea(setup, project, `${name} Area`, '#123456', '#654321')
  const lock = createNewLockType(setup, project, `${name} Lock`, '#ff0000', '!')
  const second = addMap(setup, project, `${name} Map 2`)
  setup.commit()

  const content = tx(map)
  paintCells(content, project, map, rect(0, 0, 3, 3), { areaId: area.id })
  content.commit()

  return { project, map, second, areaId: area.id, lockId: lock.id }
}

function providerServing(data: unknown): StorageProvider {
  const opened: OpenedProject = { data, handle: { providerId: 'fake', name: 'next.mvm' } }
  return {
    id: 'fake',
    label: 'Fake',
    canSaveInPlace: true,
    list: async () => [],
    remember: async () => {},
    forget: async () => {},
    adoptFileHandle: () => null,
    open: async () => opened,
    save: async (handle) => handle,
    saveAs: async () => ({ providerId: 'fake', name: 'next.mvm' }),
  }
}

beforeEach(() => {
  setActivePinia(createTestPinia())
})

afterEach(() => {
  setStorageProvider(null)
})

describe('opening a project over another one', () => {
  it('leaves no store pointing at the project that was replaced', async () => {
    const model = useModelStore()
    const selection = useSelectionStore()
    const clipboard = useClipboardStore()
    const drawArea = useDrawAreaStore()
    const doorDefaults = useDoorDefaultsStore()
    const tabs = useTabsStore()
    const file = useFileStore()

    // Project A, with every store pointed at something of its own.
    const first = projectNamed('First')
    model.replaceProject(first.project)
    model.markSaved()

    const room = [...first.map.rooms.values()][0]
    selection.set([{ kind: 'room', id: room.id }], first.map.id)
    clipboard.put(copySelection(first.map, { rooms: [room.id] }))
    drawArea.select(first.areaId)
    doorDefaults.selectLock(first.lockId)
    tabs.activate(first.second.id)

    expect(selection.isEmpty).toBe(false)
    expect(clipboard.isEmpty).toBe(false)
    expect(drawArea.areaId).toBe(first.areaId)
    expect(doorDefaults.lockTypeId).toBe(first.lockId)

    // Project B, arriving through the real load path.
    const second = projectNamed('Second')
    setStorageProvider(providerServing(toJSON(second.project)))
    expect(await file.open()).toBe(true)

    const loaded = model.project

    // Nothing may name an object the new project does not have.
    expect(loaded.areas.has(first.areaId)).toBe(false)
    expect(loaded.lockTypes.has(first.lockId)).toBe(false)

    expect(selection.isEmpty).toBe(true)
    expect(clipboard.isEmpty).toBe(true)
    expect(loaded.areas.has(drawArea.areaId as AreaId)).toBe(true)
    expect(loaded.lockTypes.has(doorDefaults.lockTypeId as LockTypeId)).toBe(true)
    expect(loaded.maps).toContain(tabs.activeTabId)
  })

  it('resets the draw area and the lock default to the guaranteed fallbacks', async () => {
    const model = useModelStore()
    const drawArea = useDrawAreaStore()
    const doorDefaults = useDoorDefaultsStore()
    const file = useFileStore()

    const first = projectNamed('First')
    model.replaceProject(first.project)
    model.markSaved()
    drawArea.select(first.areaId)
    doorDefaults.selectLock(first.lockId)

    setStorageProvider(providerServing(toJSON(projectNamed('Second').project)))
    await file.open()

    expect(drawArea.areaId).toBe(WORLD_AREA_ID)
    expect(doorDefaults.lockTypeId).toBe('open')
  })

  it('opens on a tab that belongs to the project that was loaded', async () => {
    const model = useModelStore()
    const tabs = useTabsStore()
    const file = useFileStore()

    const first = projectNamed('First')
    model.replaceProject(first.project)
    model.markSaved()
    tabs.activate(first.second.id)

    const second = projectNamed('Second')
    setStorageProvider(providerServing(toJSON(second.project)))
    await file.open()

    expect(model.project.maps).toContain(tabs.activeTabId)
    expect(tabs.tabs.map((tab) => tab.name)).toEqual(['Second Map', 'Second Map 2'])
  })

  it('starts the new project clean, with nothing to undo', async () => {
    const model = useModelStore()
    const file = useFileStore()

    const first = projectNamed('First')
    model.replaceProject(first.project)
    model.markSaved()

    setStorageProvider(providerServing(toJSON(projectNamed('Second').project)))
    await file.open()

    expect(model.status.isDirty).toBe(false)
    expect(model.status.canUndo).toBe(false)
    expect(model.status.canRedo).toBe(false)
  })

  // Reloading the same file is the case where a stale reference is least
  // likely to be noticed, because the ids look plausible.
  it('survives the same project being opened repeatedly', async () => {
    const model = useModelStore()
    const drawArea = useDrawAreaStore()
    const file = useFileStore()

    const source = projectNamed('Same')
    const bytes = toJSON(source.project)
    setStorageProvider(providerServing(bytes))

    for (let i = 0; i < 3; i++) {
      expect(await file.open()).toBe(true)
      expect(model.project.areas.has(drawArea.areaId as AreaId)).toBe(true)
      expect(model.projectName).toBe('Same')
      expect(model.status.isDirty).toBe(false)
      // The room count must not grow: each load is a fresh project, not a
      // merge into the last one.
      const map = model.project.mapsById.get(model.project.maps[0])!
      expect(map.rooms.size).toBe(1)
    }
  })
})
