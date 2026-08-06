import { describe, it, expect, afterEach, vi } from 'vitest'
import { onLaunchedFiles, resetLaunchedFiles, watchForLaunchedFiles } from './launchFiles'

// A launch queue the test drives, standing in for the one Chromium exposes
// only to an installed app.
function fakeQueue() {
  const state = { consumer: null as ((params: LaunchParams) => void) | null }
  vi.stubGlobal('launchQueue', {
    setConsumer(consumer: (params: LaunchParams) => void) {
      state.consumer = consumer
    },
  })
  return state
}

function file(name: string): FileSystemFileHandle {
  return { name } as FileSystemFileHandle
}

afterEach(() => {
  resetLaunchedFiles()
  vi.unstubAllGlobals()
})

describe('a file the operating system launched the app with', () => {
  it('reaches the handler that was waiting for it', () => {
    const queue = fakeQueue()
    watchForLaunchedFiles()

    const handled: string[][] = []
    onLaunchedFiles((files) => handled.push(files.map((one) => one.name)))

    queue.consumer?.({ files: [file('world.mvm')] })
    expect(handled).toEqual([['world.mvm']])
  })

  // The queue is claimed at boot and the handler registers when the app is
  // ready, so this order is the normal one rather than the exception.
  it('is held until something is ready to act on it', () => {
    const queue = fakeQueue()
    watchForLaunchedFiles()
    queue.consumer?.({ files: [file('early.mvm')] })

    const handled: string[] = []
    onLaunchedFiles((files) => handled.push(...files.map((one) => one.name)))
    expect(handled).toEqual(['early.mvm'])
  })

  it('is handed over once, not again on the next registration', () => {
    const queue = fakeQueue()
    watchForLaunchedFiles()
    queue.consumer?.({ files: [file('once.mvm')] })

    const first: string[] = []
    onLaunchedFiles((files) => first.push(...files.map((one) => one.name)))
    const second: string[] = []
    onLaunchedFiles((files) => second.push(...files.map((one) => one.name)))

    expect(first).toEqual(['once.mvm'])
    expect(second).toEqual([])
  })

  // An ordinary launch of the app fires the consumer too, with nothing in it.
  it('is nothing to act on when the launch carried no files', () => {
    const queue = fakeQueue()
    watchForLaunchedFiles()

    const handled: string[] = []
    onLaunchedFiles((files) => handled.push(...files.map((one) => one.name)))
    queue.consumer?.({ files: [] })

    expect(handled).toEqual([])
  })

  // The launch fires at a window that is already open as well as a cold one,
  // which is the case where unsaved work exists.
  it('reaches the handler again on a second launch', () => {
    const queue = fakeQueue()
    watchForLaunchedFiles()

    const handled: string[] = []
    onLaunchedFiles((files) => handled.push(...files.map((one) => one.name)))
    queue.consumer?.({ files: [file('first.mvm')] })
    queue.consumer?.({ files: [file('second.mvm')] })

    expect(handled).toEqual(['first.mvm', 'second.mvm'])
  })

  // Every engine but Chromium, and every Chromium tab that is not an
  // installed app.
  it('is not an error where there is no launch queue at all', () => {
    vi.stubGlobal('launchQueue', undefined)
    expect(() => watchForLaunchedFiles()).not.toThrow()
    expect(() => onLaunchedFiles(() => {})).not.toThrow()
  })
})
