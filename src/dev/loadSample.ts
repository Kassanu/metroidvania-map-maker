// Opens a checked-in sample on startup when the URL asks for one, in
// development only.
//
// This replaces the seed that used to load a fixture unconditionally. The app
// now starts on a blank project the way a built one does, and a sample arrives
// only when it is asked for by name:
//
//   /metroidvania-map-maker/?sample=sunken-city
//
// The end-to-end suite uses it to get a populated project without driving a
// file picker, which is the only way it can on an engine whose picker
// Playwright cannot reach. It is also how a developer opens a known project
// without clicking through the File menu every reload.
//
// `import.meta.env.DEV` keeps both the check and the sample bytes out of a
// production build.

import { openProject } from '@/core/serialize'
import type { useModelStore } from '@/stores/model'

// Lazy, so only the sample that is named is fetched.
const samples = import.meta.glob('/samples/*.mvm', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

function pathFor(name: string): string | null {
  const wanted = `/samples/${name}.mvm`
  return wanted in samples ? wanted : null
}

export async function loadSampleFromUrl(model: ReturnType<typeof useModelStore>): Promise<void> {
  if (!import.meta.env.DEV) return

  const name = new URLSearchParams(window.location.search).get('sample')
  if (!name) return

  const path = pathFor(name)
  if (!path) {
    console.warn(`[sample] no such sample: ${name}. Have: ${Object.keys(samples).join(', ')}`)
    return
  }

  const pending = openProject(JSON.parse(await samples[path]()))
  // The samples are asserted to load clean by `serialize/samples.test.ts`, so
  // anything to confirm here means a sample and the loader have drifted apart.
  if (pending.requiresConfirmation) {
    console.warn(`[sample] ${name} needed repairs on load:`, pending.report.events)
  }
  model.replaceProject(pending.accept())
  // It stands in for a file already on disk, so it must not open dirty.
  model.markSaved()
}
