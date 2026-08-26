// Getting a game-ready JSON export out of the app.
//
// Deliberately not part of the file store. That store holds three rules an
// export must not touch: `markSaved` follows the bytes, unsaved work is asked
// about in exactly one place, and the project is dirty until written. An
// export writes a different file for a different purpose, so it marks nothing,
// asks nothing, and dirties nothing. Keeping it here is what stops a later
// edit wiring it into any of them.
//
// Nothing here reaches a storage provider. Bytes leave through `deliver`.

import { toCombinedExport, toRoomExports } from '@/core/export'
import type { ExportScope } from '@/core/export'
import type { ProjectModel } from '@/core/types'
import { deliverArchive, deliverFile } from './deliver'
import type { ArtefactSource, ExportResult } from './deliver'
import { roomFileName } from './names'
import type { EmptyPredicate } from './scopeTree'

// One combined JSON, or one file per room. Per-room always ships as a single
// zip, on every engine, so exactly one artefact leaves the app regardless of
// what the browser can do.
export type ExportPackaging = 'combined' | 'per-room'

export interface ExportRequest {
  packaging: ExportPackaging
  // Omitted exports the whole project.
  scope?: ExportScope
}

// Any subset of the project is legal JSON, so a tab with no rooms is the only
// one that can contribute nothing. Read by the menu entry that enables itself
// and by the dialog that draws its rows, so the two cannot come to disagree.
export const jsonScopeEmpty: EmptyPredicate = (map) => map.rooms.size === 0

const JSON_MEDIA_TYPE = 'application/json'
const JSON_EXTENSION = '.json'

export async function exportProjectJson(
  project: ProjectModel,
  request: ExportRequest,
): Promise<ExportResult> {
  return request.packaging === 'combined'
    ? deliverFile(async () => encode(toCombinedExport(project, request.scope)), {
        stem: project.name,
        extension: JSON_EXTENSION,
        mediaType: JSON_MEDIA_TYPE,
      })
    : deliverArchive(perRoomSources(project, request.scope), { stem: project.name })
}

function perRoomSources(project: ProjectModel, scope: ExportScope | undefined): ArtefactSource[] {
  return toRoomExports(project, scope).map((file) => ({
    name: roomFileName(file.room.name, file.room.id),
    produce: async () => encode(file),
  }))
}

// Two-space indentation, matching what the save format writes: an export is
// meant to be opened and read, not only parsed.
function encode(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}
