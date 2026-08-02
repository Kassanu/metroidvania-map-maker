import { nextTick, ref, type ComponentPublicInstance } from 'vue'

// Click-to-rename in place: swap a label for an input, commit on Enter or
// blur, abandon on Escape. Used by the project title and the tab rename, and
// waiting for the Hierarchy's area/room rename.
//
// It settles two things the two hand-rolled copies disagreed on:
//
//  - Focus. `autofocus` is unreliable when Vue re-inserts an element that was
//    already in the DOM earlier, and it doesn't select the existing text, so
//    renaming would mean clicking in and selecting by hand. Focusing on the
//    next tick and selecting is the behaviour worth keeping.
//  - Empty input. Committing "" would silently blank a name, so a blank
//    (or whitespace-only) draft abandons the edit instead.
export function useInlineEdit(getInitial: () => string, onCommit: (value: string) => void) {
  const editing = ref(false)
  const draft = ref('')

  // Kept internal and handed out as a setter for `:ref="setInputRef"`: the
  // element is only ever needed here (to focus and select), and a callback
  // ref types cleanly at the call site where a bare ref object does not.
  const inputRef = ref<HTMLInputElement | null>(null)
  function setInputRef(el: Element | ComponentPublicInstance | null) {
    inputRef.value = el as HTMLInputElement | null
  }

  function start() {
    draft.value = getInitial()
    editing.value = true
    // The input doesn't exist until the v-if flips, hence the tick.
    nextTick(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    })
  }

  function commit() {
    // Enter commits and unmounts the input, which fires blur, which commits
    // again. Guard so the second one is a no-op.
    if (!editing.value) return
    editing.value = false
    const trimmed = draft.value.trim()
    if (trimmed) onCommit(trimmed)
  }

  function cancel() {
    editing.value = false
  }

  return { editing, draft, setInputRef, start, commit, cancel }
}
