// Load-time migration. The file carries a `version`, and each step here
// upgrades one version to the next. This project's save format cannot be
// re-derived from anywhere else, so retrofitting migration onto existing files
// would require guessing what unversioned files meant.

import { FILE_VERSION } from './schema'
import type { JsonFile } from './schema'

export class UnsupportedVersionError extends Error {
  readonly version: number

  constructor(version: number) {
    super(
      `This project was saved by a newer version of the app (file version ${version}, this build reads ${FILE_VERSION}).`,
    )
    this.name = 'UnsupportedVersionError'
    this.version = version
  }
}

// v1 stored direction as `oneWay: boolean` plus endpoint order, so a reversed
// one-way was the endpoints swapped rather than a value. Every v1 one-way was
// therefore written in its own A-to-B order, and that is exactly what `aToB`
// means: the translation is total and loses nothing.
function v1ToV2(file: JsonFile): JsonFile {
  for (const map of file.project.maps ?? []) {
    for (const transition of map.transitions ?? []) {
      const legacy = transition as { oneWay?: boolean }
      transition.direction = legacy.oneWay ? 'aToB' : 'both'
      delete legacy.oneWay
    }
  }
  return { ...file, version: 2 }
}

// Each entry upgrades a file *from* the keyed version to the next one.
const STEPS: Record<number, (file: JsonFile) => JsonFile> = {
  1: v1ToV2,
}

export function migrate(file: JsonFile): JsonFile {
  let current = file
  let version = current.version

  if (version > FILE_VERSION) throw new UnsupportedVersionError(version)

  while (version < FILE_VERSION) {
    const step = STEPS[version]
    if (!step) {
      // A gap in the chain is a build error, not a user error. Fail loudly
      // rather than silently loading data under the wrong assumptions.
      throw new Error(`no migration registered from file version ${version}`)
    }
    current = step(current)
    version = current.version
  }

  return current
}
