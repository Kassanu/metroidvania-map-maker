// Transient messages: what the app says when nothing needs answering.
//
// A plain reactive module rather than a Pinia store, because the callers are
// not all components. `src/export/` and `src/storage/` are plain modules with
// no setup context, and reaching this from one has to cost a single import.
// `src/i18n` and `src/hotkeys/escStack` are the same shape for the same
// reason. What that gives up is per-test isolation, bought back by
// `clearToasts()`.
//
// `notify` returns a handle because a sticky toast has no other way out. The
// handle is what makes sticky safe to offer: whoever raised the message owns
// closing it, and no button inside the toast does it for them.
//
// Content is named by message key, never by string. A caller holding a
// rendered string could hold a bare literal, which is the one thing the
// message layer exists to prevent.

import { computed, ref } from 'vue'
import type { MessageKey } from '@/i18n'

export type Severity = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  labelKey: MessageKey
  // Renders as the affirmative button. At most one per toast.
  primary?: boolean
  onClick: () => void
}

export interface ToastSpec {
  severity: Severity
  // Optional: a one-line message is padded by a heading rather than helped by
  // one. A title earns its place when there is a body to summarise.
  titleKey?: MessageKey
  bodyKey: MessageKey
  params?: Record<string, string | number>
  // Stays until it is dismissed. Everything else expires on its own.
  sticky?: boolean
  actions?: ToastAction[]
}

export interface Toast extends ToastSpec {
  id: number
}

export interface ToastHandle {
  dismiss(): void
}

// Milliseconds on screen. An error carries a message the user has to read and
// often cannot reproduce, so it gets longer than an acknowledgement does.
export const TOAST_DURATION = 5000
export const ERROR_DURATION = 8000

const queue = ref<Toast[]>([])
let nextId = 1

export const toasts = computed(() => queue.value)

export function notify(spec: ToastSpec): ToastHandle {
  const id = nextId++
  queue.value = [...queue.value, { ...spec, id }]
  return { dismiss: () => dismissToast(id) }
}

// Dismissing an id that has already gone is a no-op. A toast that expired on
// its own and one closed through its handle are the same outcome to whoever
// raised it, so neither has to check first.
export function dismissToast(id: number): void {
  queue.value = queue.value.filter((toast) => toast.id !== id)
}

// Test teardown. Ids restart too, so a test can assert on one.
export function clearToasts(): void {
  queue.value = []
  nextId = 1
}

export function durationOf(toast: Toast): number {
  if (toast.sticky) return Number.POSITIVE_INFINITY
  return toast.severity === 'error' ? ERROR_DURATION : TOAST_DURATION
}
