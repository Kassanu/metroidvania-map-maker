import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStorageProvider } from '@/storage'
import type { StorageProvider, SuggestedName, WriteOutcome } from '@/storage'
import { StorageError } from '@/storage'
import { renameProject } from '@/core/ops/project'
import { makeRoom, rect, setup, snapshot, tx } from '@/core/testUtils'
import { addMap } from '@/core/ops/maps'
import { paintCells } from '@/core/ops/rooms'
import { WORLD_AREA_ID } from '@/core/ids'
import { setRoomField } from '@/core/primitives'
import type { ProjectModel } from '@/core/types'
import { exportProject } from './index'

// What was handed to the provider, which is the whole of what leaves the app.
interface Written {
  contents: Blob
  name: SuggestedName
}

function spyProvider(outcome: WriteOutcome | Error = 'written') {
  const written: Written[] = []
  const save = vi.fn()
  const saveAs = vi.fn()
  const remember = vi.fn()

  const provider = {
    id: 'spy',
    label: 'Spy',
    canSaveInPlace: true,
    list: async () => [],
    remember,
    forget: async () => {},
    adoptFileHandle: () => null,
    open: async () => null,
    save,
    saveAs,
    // Records only what actually landed, so `written` means bytes on disk
    // rather than calls made.
    async saveBytes(contents: Blob, name: SuggestedName): Promise<WriteOutcome> {
      if (outcome instanceof Error) throw outcome
      if (outcome === 'written') written.push({ contents, name })
      return outcome
    },
  } as unknown as StorageProvider

  setStorageProvider(provider)
  return { written, save, saveAs, remember }
}

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

// The archive, read back as name -> contents.
async function entriesOf(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)

  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)

  const entries = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))

    const dataAt =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true)
    const stream = new DecompressionStream('deflate-raw')
    const writer = stream.writable.getWriter()
    void writer.write(new Uint8Array(bytes.subarray(dataAt, dataAt + compressedSize)))
    void writer.close()
    entries.set(name, await new Response(stream.readable).text())

    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

describe('the combined packaging', () => {
  it('writes one JSON file named for the project', async () => {
    const { written } = spyProvider()
    const { project: model } = project()
    const naming = tx()
    renameProject(naming, model, 'Super Metroid')
    naming.commit()

    const result = await exportProject(model, { packaging: 'combined' })

    expect(result).toEqual({ kind: 'written', files: 1 })
    expect(written).toHaveLength(1)
    expect(written[0].name).toEqual({ stem: 'Super Metroid', extension: '.json' })
    expect(written[0].contents.type).toBe('application/json')
  })

  it('writes what the serializer produced, indented', async () => {
    const { written } = spyProvider()
    const { project: model, first } = project()

    await exportProject(model, { packaging: 'combined' })
    const text = await textOf(written[0].contents)

    expect(text).toContain('\n  "formatVersion": 1')
    expect(JSON.parse(text).tabs[0].rooms[0].id).toBe(first.id)
  })
})

describe('the per-room packaging', () => {
  it('writes exactly one zip, whatever the engine can do', async () => {
    const { written } = spyProvider()
    const { project: model } = project()

    const result = await exportProject(model, { packaging: 'per-room' })

    expect(result).toEqual({ kind: 'written', files: 3 })
    expect(written).toHaveLength(1)
    expect(written[0].name.extension).toBe('.zip')
    expect(written[0].contents.type).toBe('application/zip')
  })

  it('names each entry for its room, falling back to the id', async () => {
    const { written } = spyProvider()
    const { project: model, first, second, third } = project()

    await exportProject(model, { packaging: 'per-room' })
    const entries = await entriesOf(written[0].contents)

    expect([...entries.keys()].sort()).toEqual(
      [`landing-site--${first.id}.json`, `${second.id}.json`, `${third.id}.json`].sort(),
    )
  })

  it('puts one room in each file, with its tab beside it', async () => {
    const { written } = spyProvider()
    const { project: model, other, third } = project()

    await exportProject(model, { packaging: 'per-room' })
    const entries = await entriesOf(written[0].contents)
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

    const combined = await exportProject(model, { packaging: 'combined', scope })
    expect(combined).toEqual({ kind: 'written', files: 1 })
    const tabs = JSON.parse(await textOf(written[0].contents)).tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].rooms.map((room: { id: string }) => room.id)).toEqual([first.id])

    const perRoom = await exportProject(model, { packaging: 'per-room', scope })
    expect(perRoom).toEqual({ kind: 'written', files: 1 })
    expect([...(await entriesOf(written[1].contents)).keys()]).toEqual([
      `landing-site--${first.id}.json`,
    ])
  })
})

describe('when the bytes do not land', () => {
  it('reports a dismissed destination as cancelled, having written nothing', async () => {
    const { written } = spyProvider('cancelled')
    const { project: model } = project()

    expect(await exportProject(model, { packaging: 'combined' })).toEqual({ kind: 'cancelled' })
    expect(written).toEqual([])
  })

  it('carries a failure through rather than throwing at the caller', async () => {
    spyProvider(new StorageError('the disk went away'))
    const { project: model } = project()

    expect(await exportProject(model, { packaging: 'per-room' })).toEqual({
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
      exportProject(model, { packaging: 'per-room' }),
    )
    expect(after).toEqual(before)
  })

  it('bumps neither revision counter, so nothing downstream re-derives', async () => {
    spyProvider()
    const { project: model } = project()
    const rev = model.rev
    const structureRev = model.structureRev

    await exportProject(model, { packaging: 'combined' })

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

    await exportProject(model, { packaging: 'combined' })

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

      await exportProject(model, { packaging })

      expect(save).not.toHaveBeenCalled()
      expect(saveAs).not.toHaveBeenCalled()
      expect(remember).not.toHaveBeenCalled()
    },
  )
})
