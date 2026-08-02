// A project to look at, in development only.
//
// Nothing can create a room until the paint gesture lands, so without this the
// canvas work would be built against a blank page. It is a saved v1 file rather
// than a throwaway builder, so the load path gets walked on every dev reload.
//
// Distinct from `core/serialize/fixtures/v1-project.mvm.json`, which is frozen
// evidence of the format and must never be edited to get something to look at.
// This one is content: one of everything the renderer can draw, arranged so
// each case is visible at once. Delete it when save/load lands.
// `import.meta.env.DEV` keeps it out of the production bundle, so a built app
// still starts on a blank project.

import { openProject } from '@/core/serialize'
import fixture from './fixtures/dev-project.mvm.json'
import type { useModelStore } from '@/stores/model'

export function seedDevProject(model: ReturnType<typeof useModelStore>): void {
  if (!import.meta.env.DEV) return

  const pending = openProject(fixture)
  // The fixture is asserted to load clean by `devFixture.test.ts`, so anything
  // to confirm here means the file and the loader have drifted apart. Worth
  // saying out loud rather than silently accepting a repaired project.
  if (pending.requiresConfirmation) {
    console.warn('[dev seed] fixture needed repairs on load:', pending.report.events)
  }
  // The project is only reachable through `accept()`. That is structural, not
  // a convention: the confirmation gate cannot be bypassed by reading a field.
  model.replaceProject(pending.accept())
  // A seeded project is not unsaved work. It stands in for a file already on
  // disk, so it must not open with a dirty marker.
  model.markSaved()
}
