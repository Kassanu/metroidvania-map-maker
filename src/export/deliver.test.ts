import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError, setStorageProvider } from '@/storage'
import { deliverArchive, deliverFile } from './deliver'
import type { ArtefactSource } from './deliver'
import { readZip, spyProvider } from './testUtils'

afterEach(() => setStorageProvider(null))

const TEXT = 'text/plain'

function bytes(body: string) {
  return async () => new TextEncoder().encode(body)
}

function source(name: string, body: string): ArtefactSource {
  return { name, produce: bytes(body) }
}

function failing(name: string, reason: string): ArtefactSource {
  return { name, produce: () => Promise.reject(new Error(reason)) }
}

async function namesIn(blob: Blob): Promise<string[]> {
  return (await readZip(blob)).map((entry) => entry.name)
}

describe('exactly one artefact leaves per export', () => {
  it('writes a lone artefact as itself, named by the caller', async () => {
    const { written, saveBytes } = spyProvider()

    const result = await deliverFile(bytes('body'), {
      stem: 'World',
      extension: '.txt',
      mediaType: TEXT,
    })

    expect(result).toEqual({ kind: 'written', files: 1 })
    expect(saveBytes).toHaveBeenCalledTimes(1)
    expect(written[0].name).toEqual({ stem: 'World', extension: '.txt' })
    expect(written[0].contents.type).toBe(TEXT)
    expect(await written[0].contents.text()).toBe('body')
  })

  // The name is never split back out of a filename: a project may be called
  // anything, and the provider sanitizes the stem but not the extension.
  it('keeps a stem carrying a dot whole', async () => {
    const { written } = spyProvider()

    await deliverFile(bytes('a'), { stem: 'World v1.2', extension: '.txt', mediaType: TEXT })

    expect(written[0].name).toEqual({ stem: 'World v1.2', extension: '.txt' })
  })

  it('writes one archive for several artefacts', async () => {
    const { written, saveBytes } = spyProvider()

    const result = await deliverArchive([source('a.txt', 'a'), source('b.txt', 'b')], {
      stem: 'World',
    })

    expect(result).toEqual({ kind: 'written', files: 2 })
    expect(saveBytes).toHaveBeenCalledTimes(1)
    expect(written[0].name).toEqual({ stem: 'World', extension: '.zip' })
    expect(await namesIn(written[0].contents)).toEqual(['a.txt', 'b.txt'])
  })

  // Whether a lone artefact is archived is the caller's, not the count's:
  // per-room JSON archives a single room and a single-tab image does not.
  it('archives a lone artefact when that is what was asked for', async () => {
    const { written } = spyProvider()

    const result = await deliverArchive([source('only.txt', 'a')], { stem: 'World' })

    expect(result).toEqual({ kind: 'written', files: 1 })
    expect(written[0].name).toEqual({ stem: 'World', extension: '.zip' })
    expect(await namesIn(written[0].contents)).toEqual(['only.txt'])
  })

  // An empty archive reports success and raises a success toast for a file
  // holding nothing, which looks identical to a working export until it is
  // opened.
  it('refuses an archive of nothing rather than writing an empty one', async () => {
    const { saveBytes } = spyProvider()

    const result = await deliverArchive([], { stem: 'World' })

    expect(result.kind).toBe('failed')
    expect(saveBytes).not.toHaveBeenCalled()
  })
})

describe('a batch is all or nothing', () => {
  it('writes nothing at all when one artefact fails to produce', async () => {
    const { saveBytes } = spyProvider()

    const result = await deliverArchive(
      [source('a.txt', 'a'), failing('b.txt', 'the canvas was blank'), source('c.txt', 'c')],
      { stem: 'World' },
    )

    expect(result).toEqual({ kind: 'failed', message: 'the canvas was blank' })
    expect(saveBytes).not.toHaveBeenCalled()
  })

  it('does not produce what follows a failure', async () => {
    spyProvider()
    const later = vi.fn(bytes('c'))

    await deliverArchive([failing('a.txt', 'no'), { name: 'c.txt', produce: later }], {
      stem: 'World',
    })

    expect(later).not.toHaveBeenCalled()
  })
})

describe('when the bytes do not land', () => {
  it('reports a dismissed destination as cancelled, having written nothing', async () => {
    const { written } = spyProvider('cancelled')

    const result = await deliverFile(bytes('a'), {
      stem: 'World',
      extension: '.txt',
      mediaType: TEXT,
    })

    expect(result).toEqual({ kind: 'cancelled' })
    expect(written).toHaveLength(0)
  })

  it('carries a failure through rather than throwing at the caller', async () => {
    spyProvider(new StorageError('there was no room left'))

    const result = await deliverArchive([source('a.txt', 'a')], { stem: 'World' })

    expect(result).toEqual({ kind: 'failed', message: 'there was no room left' })
  })

  it('carries a failure through from the single-file path too', async () => {
    spyProvider(new StorageError('there was no room left'))

    const result = await deliverFile(bytes('a'), {
      stem: 'World',
      extension: '.txt',
      mediaType: TEXT,
    })

    expect(result).toEqual({ kind: 'failed', message: 'there was no room left' })
  })
})
