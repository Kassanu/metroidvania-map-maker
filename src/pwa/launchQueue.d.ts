// The File Handling API, which the TypeScript DOM lib does not declare.
//
// Chromium only, and only in an installed app: `window.launchQueue` is absent
// everywhere else, which is why it is optional here rather than assumed.
// Kept narrow on purpose, to the members this app reads.

interface LaunchParams {
  // The files the launch was about. Empty for an ordinary launch of the app
  // itself, which fires the consumer just the same.
  readonly files: readonly FileSystemFileHandle[]
  readonly targetURL?: string
}

interface LaunchQueue {
  // The queue holds the launch until a consumer is set, so registering late
  // loses nothing. It is set at boot anyway, because "late" has no upper
  // bound once a render can await something.
  setConsumer(consumer: (params: LaunchParams) => void): void
}

interface Window {
  launchQueue?: LaunchQueue
}
