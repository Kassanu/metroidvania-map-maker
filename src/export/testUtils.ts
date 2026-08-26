// The two doubles every export test needs: what the app handed the provider,
// and what an archive turned out to hold.
//
// One copy of each. Three hand-rolled zip readers disagreed on what a
// malformed archive does, so a test that hit one read a garbage entry count
// off the end of the buffer and failed as a range error rather than as a
// missing record.

import { vi } from 'vitest'
import { setStorageProvider } from '@/storage'
import type { StorageProvider, SuggestedName, WriteOutcome } from '@/storage'
import { crc32 } from './zip'

const END_SIGNATURE = 0x06054b50

export interface Written {
  contents: Blob
  name: SuggestedName
}

export interface ZipRead {
  name: string
  text: string
  crcMatches: boolean
}

// Installs itself as the active provider. `written` records only what actually
// landed, so it means bytes on disk; `saveBytes` records calls, which is what a
// rule about never reaching the provider is asserted against.
export function spyProvider(outcome: WriteOutcome | Error = 'written') {
  const written: Written[] = []
  const saveBytes = vi.fn(async (contents: Blob, name: SuggestedName): Promise<WriteOutcome> => {
    if (outcome instanceof Error) throw outcome
    if (outcome === 'written') written.push({ contents, name })
    return outcome
  })

  // The project-file half of the interface, spied so a test can assert an
  // export never reaches it.
  const save = vi.fn()
  const saveAs = vi.fn()
  const remember = vi.fn()

  const provider = {
    id: 'spy',
    label: 'Spy',
    canSaveInPlace: true,
    list: async () => [],
    forget: async () => {},
    adoptFileHandle: () => null,
    open: async () => null,
    remember,
    save,
    saveAs,
    saveBytes,
  } as unknown as StorageProvider

  setStorageProvider(provider)
  return { written, saveBytes, save, saveAs, remember, provider }
}

// Walks the archive from its end, exactly as a reader must: find the
// end-of-central-directory record, take the directory from where it points,
// and reach each entry's data through the offset in its own record.
export async function readZip(blob: Blob): Promise<ZipRead[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)

  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== END_SIGNATURE) end--
  if (end < 0) throw new Error('no end-of-central-directory record')

  const count = view.getUint16(10 + end, true)
  let at = view.getUint32(16 + end, true)

  const entries: ZipRead[] = []
  for (let i = 0; i < count; i++) {
    const crc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))

    // The local header repeats the name and extra lengths, and they are not
    // required to match the central ones, so the data offset is computed from
    // the local header's own fields.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataAt = localOffset + 30 + localNameLength + localExtraLength
    const inflated = await inflateRaw(bytes.subarray(dataAt, dataAt + compressedSize))

    entries.push({
      name,
      text: new TextDecoder().decode(inflated),
      crcMatches: crc32(inflated) === crc,
    })

    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

// The archive as name to contents, for tests that judge what is in it rather
// than that it is well formed.
export async function zipEntries(blob: Blob): Promise<Map<string, string>> {
  return new Map((await readZip(blob)).map((entry) => [entry.name, entry.text]))
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  void writer.write(new Uint8Array(bytes))
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}
