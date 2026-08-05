import { watch } from 'vue'
import { useModelStore } from '@/stores/model'

// The one warning the app cannot draw itself.
//
// Closing the tab is the single action no undo reaches, so the browser's own
// confirmation is the last thing between a user and their afternoon. Every
// other replacement of the project goes through the three-way prompt in
// `stores/file.ts`; this covers the one the page does not control.
//
// Registered only while there is unsaved work, for two reasons. A listener
// that is always attached makes the browser treat the page as unload-blocking
// for its whole life, and it would fire the dialog on a clean project, which
// trains people to dismiss it without reading.
export function useUnloadGuard(): void {
  const model = useModelStore()

  // `preventDefault` is the modern signal; assigning `returnValue` is what
  // older engines read. Browsers show their own wording either way, so there
  // is no message worth composing here.
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault()
    event.returnValue = ''
  }

  watch(
    () => model.status.isDirty,
    (dirty) => {
      if (dirty) window.addEventListener('beforeunload', onBeforeUnload)
      else window.removeEventListener('beforeunload', onBeforeUnload)
    },
    { immediate: true },
  )
}
