// Getting an export out of the app.
//
// Deliberately not part of the file store. That store holds three rules an
// export must not touch: `markSaved` follows the bytes, unsaved work is asked
// about in exactly one place, and the project is dirty until written. An
// export writes a different file for a different purpose, so it marks nothing,
// asks nothing, and dirties nothing. Keeping it here is what stops a later
// edit wiring it into any of them.
//
// The only thing that leaves is bytes, through `StorageProvider.saveBytes`.
// Nothing here knows which provider is running.

import { toCombinedExport, toRoomExports } from '@/core/export'
import type { ExportScope } from '@/core/export'
import type { ProjectModel } from '@/core/types'
import { StorageError, getStorageProvider } from '@/storage'
import { roomFileName } from './names'
import { buildZip } from './zip'
import type { ZipEntry } from './zip'

// One combined JSON, or one file per room. Per-room always ships as a single
// zip, on every engine, so exactly one artefact leaves the app regardless of
// what the browser can do.
export type ExportPackaging = 'combined' | 'per-room'

export interface ExportRequest {
  packaging: ExportPackaging
  // Omitted exports the whole project.
  scope?: ExportScope
}

// What the caller can do about it: report success with a count, say nothing
// happened, or show why it did not. No translated strings, because the layer
// that has a toast to put them in owns the wording.
export type ExportResult =
  { kind: 'written'; files: number } | { kind: 'cancelled' } | { kind: 'failed'; message: string }

const JSON_MEDIA_TYPE = 'application/json'

export async function exportProject(
  project: ProjectModel,
  request: ExportRequest,
): Promise<ExportResult> {
  try {
    return request.packaging === 'combined'
      ? await writeCombined(project, request.scope)
      : await writePerRoom(project, request.scope)
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}

async function writeCombined(
  project: ProjectModel,
  scope: ExportScope | undefined,
): Promise<ExportResult> {
  const contents = new Blob([serialize(toCombinedExport(project, scope))], {
    type: JSON_MEDIA_TYPE,
  })
  const outcome = await getStorageProvider().saveBytes(contents, {
    stem: project.name,
    extension: '.json',
  })
  return outcome === 'written' ? { kind: 'written', files: 1 } : { kind: 'cancelled' }
}

async function writePerRoom(
  project: ProjectModel,
  scope: ExportScope | undefined,
): Promise<ExportResult> {
  const entries: ZipEntry[] = toRoomExports(project, scope).map((file) => ({
    name: roomFileName(file.room.name, file.room.id),
    bytes: new TextEncoder().encode(serialize(file)),
  }))

  const contents = await buildZip(entries)
  const outcome = await getStorageProvider().saveBytes(contents, {
    stem: project.name,
    extension: '.zip',
  })
  return outcome === 'written' ? { kind: 'written', files: entries.length } : { kind: 'cancelled' }
}

// Two-space indentation, matching what the save format writes: an export is
// meant to be opened and read, not only parsed.
function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function messageOf(error: unknown): string {
  if (error instanceof StorageError) return error.message
  return error instanceof Error ? error.message : 'the export could not be written'
}
