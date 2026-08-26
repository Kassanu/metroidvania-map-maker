// What a dialog does with an export's outcome, shared by every dialog that
// starts one.
//
// The outcome is reported as a toast, so a dialog is only ever open for a
// decision. It closes once the bytes have landed, and stays open on a failure
// so a retry costs no re-ticking. A cancelled destination raises nothing at
// all: the user dismissed a picker, not an export, and reporting it would name
// their own click as a problem.
//
// `busy` is held across the whole attempt so a second Export cannot start one
// while the first is still writing.

import { ref } from 'vue'
import type { Ref } from 'vue'
import { notify } from '@/notify'
import type { ExportResult } from './deliver'

// What the caller does about it: an export that landed is spent and its dialog
// is finished, and anything else leaves the dialog holding what was ticked.
export type ExportRunOutcome = 'close' | 'stay'

export function useExportRun(): {
  busy: Ref<boolean>
  run: (attempt: () => Promise<ExportResult>) => Promise<ExportRunOutcome>
} {
  const busy = ref(false)

  async function run(attempt: () => Promise<ExportResult>): Promise<ExportRunOutcome> {
    if (busy.value) return 'stay'
    busy.value = true
    try {
      const result = await attempt()
      if (result.kind === 'written') {
        notify({ severity: 'success', bodyKey: 'modal.export.succeeded' })
        return 'close'
      }
      if (result.kind === 'failed') {
        notify({
          severity: 'error',
          bodyKey: 'modal.export.failed',
          params: { message: result.message },
        })
      }
      return 'stay'
    } finally {
      busy.value = false
    }
  }

  return { busy, run }
}
