import { afterEach, describe, expect, it } from 'vitest'
import { StorageError, setStorageProvider } from '@/storage'
import { renameProject } from '@/core/ops/project'
import { makeRoom, rect, setup, snapshot, tx } from '@/core/testUtils'
import { addMap } from '@/core/ops/maps'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { setRoomField } from '@/core/primitives'
import type { ProjectModel } from '@/core/types'
import { exportProjectJson } from './index'
import { spyProvider, zipEntries } from './testUtils'

afterEach(() => setStorageProvider(null))

// Two rooms on one tab, a third on another, so packaging and scope have
// something to tell apart.
function project() {
  const { project, map, history } = setup()
  const first = makeRoom(project, map, rect(0, 0, 2, 2))
  const second = makeRoom(project, map, rect(5, 0, 2, 2))

  const naming = tx(map)
  setRoomField(naming, map, first, 'name', 'Landing Site')
  setRoomField(naming, map, second, 'name', '')
  naming.commit()

  const adding = tx()
  const other = addMap(adding, project, 'Caves')
  adding.commit()
  const third = makeRoom(project, other, rect(0, 0, 1, 1))

  return { project, map, other, first, second, third, history }
}

async function textOf(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer())
}

describe('the combined packaging', () => {
  it('writes one JSON file named for the project', async () => {
    const { written } = spyProvider()
    const { project: model } = project()
    const naming = tx()
    renameProject(naming, model, 'Super Metroid')
    naming.commit()

    const result = await exportProjectJson(model, { packaging: 'combined' })

    expect(result).toEqual({ kind: 'written', files: 1 })
    expect(written).toHaveLength(1)
    expect(written[0].name).toEqual({ stem: 'Super Metroid', extension: '.json' })
    expect(written[0].contents.type).toBe('application/json')
  })

  it('writes what the serializer produced, indented', async () => {
    const { written } = spyProvider()
    const { project: model, first } = project()

    await exportProjectJson(model, { packaging: 'combined' })
    const text = await textOf(written[0].contents)

    expect(text).toContain('\n  "formatVersion": 1')
    expect(JSON.parse(text).tabs[0].rooms[0].id).toBe(first.id)
  })
})

describe('the per-room packaging', () => {
  it('writes exactly one zip, whatever the engine can do', async () => {
    const { written } = spyProvider()
    const { project: model } = project()

    const result = await exportProjectJson(model, { packaging: 'per-room' })

    expect(result).toEqual({ kind: 'written', files: 3 })
    expect(written).toHaveLength(1)
    expect(written[0].name.extension).toBe('.zip')
    expect(written[0].contents.type).toBe('application/zip')
  })

  it('names each entry for its room, falling back to the id', async () => {
    const { written } = spyProvider()
    const { project: model, first, second, third } = project()

    await exportProjectJson(model, { packaging: 'per-room' })
    const entries = await zipEntries(written[0].contents)

    expect([...entries.keys()].sort()).toEqual(
      [`landing-site--${first.id}.json`, `${second.id}.json`, `${third.id}.json`].sort(),
    )
  })

  it('puts one room in each file, with its tab beside it', async () => {
    const { written } = spyProvider()
    const { project: model, other, third } = project()

    await exportProjectJson(model, { packaging: 'per-room' })
    const entries = await zipEntries(written[0].contents)
    const file = JSON.parse(entries.get(`${third.id}.json`)!)

    expect(file.room.id).toBe(third.id)
    expect(file.tab).toEqual({ id: other.id, name: 'Caves', notes: '' })
  })
})

describe('scope', () => {
  it('writes only the rooms it names, in either packaging', async () => {
    const { written } = spyProvider()
    const { project: model, map, first } = project()
    const scope = new Map([[map.id, new Set([first.id])]])

    const combined = await exportProjectJson(model, { packaging: 'combined', scope })
    expect(combined).toEqual({ kind: 'written', files: 1 })
    const tabs = JSON.parse(await textOf(written[0].contents)).tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].rooms.map((room: { id: string }) => room.id)).toEqual([first.id])

    const perRoom = await exportProjectJson(model, { packaging: 'per-room', scope })
    expect(perRoom).toEqual({ kind: 'written', files: 1 })
    expect([...(await zipEntries(written[1].contents)).keys()]).toEqual([
      `landing-site--${first.id}.json`,
    ])
  })
})

describe('when the bytes do not land', () => {
  it('reports a dismissed destination as cancelled, having written nothing', async () => {
    const { written } = spyProvider('cancelled')
    const { project: model } = project()

    expect(await exportProjectJson(model, { packaging: 'combined' })).toEqual({ kind: 'cancelled' })
    expect(written).toEqual([])
  })

  it('carries a failure through rather than throwing at the caller', async () => {
    spyProvider(new StorageError('the disk went away'))
    const { project: model } = project()

    expect(await exportProjectJson(model, { packaging: 'per-room' })).toEqual({
      kind: 'failed',
      message: 'the disk went away',
    })
  })
})

// The rule the file store exists to enforce for saves, and that an export must
// not participate in at all.
describe('export is write-only', () => {
  async function unchangedBy(
    run: (model: ProjectModel) => Promise<unknown>,
  ): Promise<{ before: unknown; after: unknown }> {
    const { project: model } = project()
    const before = snapshot(model)
    await run(model)
    return { before, after: snapshot(model) }
  }

  it('leaves the project exactly as it found it', async () => {
    spyProvider()
    const { before, after } = await unchangedBy((model) =>
      exportProjectJson(model, { packaging: 'per-room' }),
    )
    expect(after).toEqual(before)
  })

  it('bumps neither revision counter, so nothing downstream re-derives', async () => {
    spyProvider()
    const { project: model } = project()
    const rev = model.rev
    const structureRev = model.structureRev

    await exportProjectJson(model, { packaging: 'combined' })

    expect(model.rev).toBe(rev)
    expect(model.structureRev).toBe(structureRev)
  })

  it('leaves a saved project clean and adds no undo step', async () => {
    spyProvider()
    const { project: model, map, history } = project()
    const edit = history.begin('Paint room', { kind: 'map', mapId: map.id })
    paintCells(edit, model, map, ['20,20'], { areaId: WORLD_AREA_ID })
    history.commit(edit)
    history.markSaved()
    expect(history.isDirty).toBe(false)

    await exportProjectJson(model, { packaging: 'combined' })

    expect(history.isDirty).toBe(false)
    expect(history.undoLabel).toBe('Paint room')
  })

  // Both packagings, because they reach the provider by different routes and
  // a rule proved on one of them says nothing about the other.
  it.each(['combined', 'per-room'] as const)(
    'never touches the project file or the recent list: %s',
    async (packaging) => {
      const { save, saveAs, remember } = spyProvider()
      const { project: model } = project()

      await exportProjectJson(model, { packaging })

      expect(save).not.toHaveBeenCalled()
      expect(saveAs).not.toHaveBeenCalled()
      expect(remember).not.toHaveBeenCalled()
    },
  )
})

// Nothing above `deliver` reaches a storage provider. Asserted over every
// module in the folder rather than over this one, so it still holds for
// exporters written later: a rule that names one file stops guarding the
// moment a second producer lands beside it.
describe('an exporter delivers rather than writes', () => {
  const sources = import.meta.glob('/src/export/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  // `deliver` is the one that may, and `testUtils` builds the double that
  // stands in for one.
  const ALLOWED = ['/src/export/deliver.ts', '/src/export/testUtils.ts']

  const guarded = Object.entries(sources).filter(
    ([path]) => !path.endsWith('.test.ts') && !ALLOWED.includes(path),
  )

  it('is looking at the folder, not an empty glob', () => {
    expect(guarded.map(([path]) => path)).toContain('/src/export/index.ts')
    expect(guarded.length).toBeGreaterThan(1)
  })

  it.each(guarded)('%s names no provider and no write call', (_path, text) => {
    expect(text).not.toMatch(/from '[^']*\/storage'/)
    expect(text).not.toContain('saveBytes')
  })
})
