// Files handed to the app by the operating system: double-clicking a `.mvm`
// in Explorer or Finder, once the app is installed.
//
// Two things make this different from Open, and both are why it is not simply
// another trigger for it.
//
// It arrives with no user gesture, so anything downstream that needs one has
// to cope. Chromium grants a launched file's handle implicitly, since
// double-clicking it is the permission, and the refusal path covers the case
// where it does not.
//
// And the launch fires at an already-running instance as well as a cold one,
// which is the case where unsaved work actually exists. The handler is the
// same either way; guarding that work is the caller's job, through the one
// function that asks about it.
//
// The consumer is registered at boot rather than when a component mounts.
// The queue does hold a launch until someone claims it, but "when a component
// mounts" has no upper bound once a render can await something, and a dropped
// launch looks exactly like a double-click that did nothing.

type LaunchHandler = (files: readonly FileSystemFileHandle[]) => void

// Launches that arrived before anything was ready to act on them.
let waiting: FileSystemFileHandle[] = []
let handler: LaunchHandler | null = null

function deliver(files: readonly FileSystemFileHandle[]): void {
  if (files.length === 0) return
  if (handler) handler(files)
  else waiting.push(...files)
}

// Claims the launch queue. Safe to call where there is no queue at all, which
// is every engine but Chromium and every Chromium tab that is not an
// installed app.
export function watchForLaunchedFiles(): void {
  window.launchQueue?.setConsumer((params) => deliver(params.files))
}

// Registers what to do with them, and hands over anything that arrived first.
export function onLaunchedFiles(next: LaunchHandler): void {
  handler = next
  const pending = waiting
  waiting = []
  if (pending.length > 0) next(pending)
}

// Drops the handler and anything queued behind it.
export function resetLaunchedFiles(): void {
  handler = null
  waiting = []
}
