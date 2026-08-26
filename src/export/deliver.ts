// The last step of every export: turning what was produced into the one file
// that leaves the app.
//
// Exactly one artefact leaves per export, however many were produced. Nothing
// above this reaches `StorageProvider.saveBytes`, which is what keeps that rule
// in one place as producers are added.
//
// A batch is all or nothing. Sources are producers rather than finished bytes
// so this is enforceable here: every one is awaited before anything is written,
// and a rejection answers a failure with nothing having reached the provider.
// Half an archive is indistinguishable from a whole one on the far end.
//
// Two entry points rather than one with a count-based rule, because whether a
// lone artefact ships bare or inside an archive is not a property of the count:
// per-room JSON archives a single room, and a single-tab image does not. The
// caller already knows which it wants, and naming it removes the case where a
// bare-file request quietly produces a zip.
//
// What leaves is named by the caller, never split back out of an entry name: a
// project or a map may be called anything, dots included, so splitting a
// filename would hand the provider the wrong halves to sanitize.

import { StorageError, getStorageProvider } from '@/storage'
import { buildZip } from './zip'
import type { ZipEntry } from './zip'

export interface ArtefactSource {
  // The entry name inside the archive, extension included. Callers make these
  // unique among themselves; nothing here dedupes.
  name: string
  produce: () => Promise<Uint8Array<ArrayBuffer>>
}

// What the caller can do about it: report success with a count, say nothing
// happened, or show why it did not. No translated strings, because the layer
// that has a toast to put them in owns the wording.
export type ExportResult =
  { kind: 'written'; files: number } | { kind: 'cancelled' } | { kind: 'failed'; message: string }

export async function deliverFile(
  produce: () => Promise<Uint8Array<ArrayBuffer>>,
  options: { stem: string; extension: string; mediaType: string },
): Promise<ExportResult> {
  try {
    const contents = new Blob([await produce()], { type: options.mediaType })
    const outcome = await getStorageProvider().saveBytes(contents, {
      stem: options.stem,
      extension: options.extension,
    })
    return outcome === 'written' ? { kind: 'written', files: 1 } : { kind: 'cancelled' }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}

export async function deliverArchive(
  sources: ArtefactSource[],
  options: { stem: string },
): Promise<ExportResult> {
  // Refused rather than written. An empty archive reports success and raises a
  // success toast for a file holding nothing, which is the one outcome that
  // looks identical to a working export all the way to whoever opens it.
  if (sources.length === 0) return { kind: 'failed', message: 'there was nothing to export' }

  try {
    const entries: ZipEntry[] = []
    for (const source of sources) entries.push({ name: source.name, bytes: await source.produce() })

    const contents = await buildZip(entries)
    const outcome = await getStorageProvider().saveBytes(contents, {
      stem: options.stem,
      extension: '.zip',
    })
    return outcome === 'written'
      ? { kind: 'written', files: entries.length }
      : { kind: 'cancelled' }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof StorageError) return error.message
  return error instanceof Error ? error.message : 'the export could not be written'
}
