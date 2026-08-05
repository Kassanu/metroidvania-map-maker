import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '@/core/storage/provider'
import type { StorageHandle } from '@/core/storage/provider'
import { LIMITS } from '@/core/serialize/limits'
import { FSA_PROVIDER_ID, createFsaProvider, supportsFileSystemAccess } from './fsaProvider'

// A fake handle that records what was written to it and can be told to
// misbehave the way a real one does: refuse permission, fail the write, or
// report a size past the cap without allocating it.
function fakeFile(options: { name?: string; contents?: string; size?: number } = {}) {
  const state = {
    name: options.name ?? 'project.mvm',
    contents: options.contents ?? '{"format":"metroidvania-map-maker"}',
    permission: 'granted' as PermissionState,
    requested: 0,
    written: [] as string[],
    aborted: 0,
    closed: 0,
    failWrite: false,
  }

  const handle = {
    name: state.name,
    queryPermission: vi.fn(async () => state.permission),
    requestPermission: vi.fn(async () => {
      state.requested += 1
      return state.permission
    }),
    getFile: vi.fn(async () => ({
      size: options.size ?? state.contents.length,
      text: async () => state.contents,
    })),
    createWritable: vi.fn(async () => ({
      write: async (text: string) => {
        if (state.failWrite) throw new DOMException('disk full', 'QuotaExceededError')
        state.written.push(text)
      },
      abort: async () => {
        state.aborted += 1
      },
      close: async () => {
        state.closed += 1
        state.contents = state.written[state.written.length - 1] ?? state.contents
      },
    })),
  } as unknown as FileSystemFileHandle

  return { handle, state }
}

function handleFor(file: FileSystemFileHandle): StorageHandle {
  return { providerId: FSA_PROVIDER_ID, name: file.name, file } as StorageHandle
}

const provider = createFsaProvider()

beforeEach(() => {
  vi.stubGlobal('showOpenFilePicker', vi.fn())
  vi.stubGlobal('showSaveFilePicker', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feature detection', () => {
  it('asks the window rather than the user agent', () => {
    expect(supportsFileSystemAccess()).toBe(true)
    vi.unstubAllGlobals()
    expect(supportsFileSystemAccess()).toBe(false)
  })
})

describe('open', () => {
  it('reads the picked file and hands back a handle to save to', async () => {
    const { handle } = fakeFile({ contents: '{"format":"x","version":2}' })
    vi.mocked(showOpenFilePicker).mockResolvedValue([handle])

    const opened = await provider.open()
    expect(opened?.data).toEqual({ format: 'x', version: 2 })
    expect(opened?.handle.name).toBe('project.mvm')
    expect(opened?.handle.providerId).toBe(FSA_PROVIDER_ID)
  })

  // The rule the whole File menu leans on: changing your mind is not an error.
  it('answers null when the picker is dismissed', async () => {
    vi.mocked(showOpenFilePicker).mockRejectedValue(new DOMException('no', 'AbortError'))
    await expect(provider.open()).resolves.toBeNull()
  })

  it('refuses a file past the byte cap before reading it', async () => {
    const { handle, state } = fakeFile({ size: LIMITS.bytes + 1 })
    vi.mocked(showOpenFilePicker).mockResolvedValue([handle])

    await expect(provider.open()).rejects.toThrow(StorageError)
    // The point of checking `size`: the bytes are never pulled into memory.
    const blob = await vi.mocked(handle.getFile).mock.results[0].value
    expect(state.written).toEqual([])
    expect(blob.size).toBe(LIMITS.bytes + 1)
  })

  it('reopens a handle it is given without showing a picker', async () => {
    const { handle } = fakeFile({ contents: '{"reopened":true}' })
    const opened = await provider.open(handleFor(handle))
    expect(opened?.data).toEqual({ reopened: true })
    expect(showOpenFilePicker).not.toHaveBeenCalled()
  })

  it('reports a refused read permission rather than returning nothing', async () => {
    const { handle, state } = fakeFile()
    state.permission = 'denied'
    await expect(provider.open(handleFor(handle))).rejects.toThrow(StorageError)
  })

  it('turns unreadable bytes into a StorageError', async () => {
    const { handle } = fakeFile({ contents: '{ truncated' })
    vi.mocked(showOpenFilePicker).mockResolvedValue([handle])
    await expect(provider.open()).rejects.toThrow(StorageError)
  })
})

describe('save', () => {
  it('writes back to the same handle with no second prompt', async () => {
    const { handle, state } = fakeFile()
    const saved = await provider.save(handleFor(handle), { format: 'x' })

    expect(state.written).toHaveLength(1)
    expect(JSON.parse(state.written[0])).toEqual({ format: 'x' })
    expect(state.closed).toBe(1)
    expect(handle.requestPermission).not.toHaveBeenCalled()
    expect(showSaveFilePicker).not.toHaveBeenCalled()
    expect(saved.name).toBe('project.mvm')
  })

  it('asks for write permission only when it does not already have it', async () => {
    const { handle, state } = fakeFile()
    state.permission = 'prompt'
    await expect(provider.save(handleFor(handle), {})).rejects.toThrow(StorageError)
    expect(state.requested).toBe(1)
  })

  // The rule that keeps a half-written file from replacing a good one.
  it('aborts the writable when the write fails, leaving the file alone', async () => {
    const { handle, state } = fakeFile({ contents: 'the original' })
    state.failWrite = true

    await expect(provider.save(handleFor(handle), {})).rejects.toThrow(StorageError)
    expect(state.aborted).toBe(1)
    expect(state.closed).toBe(0)
    expect(state.contents).toBe('the original')
  })

  it('refuses a handle from another provider', async () => {
    const foreign = { providerId: 'somewhere-else', name: 'x.mvm' } as StorageHandle
    await expect(provider.save(foreign, {})).rejects.toThrow(StorageError)
  })
})

describe('saveAs', () => {
  it('prompts, writes, and hands back the new handle', async () => {
    const { handle, state } = fakeFile({ name: 'chosen.mvm' })
    vi.mocked(showSaveFilePicker).mockResolvedValue(handle)

    const saved = await provider.saveAs({ format: 'x' }, 'My Project')
    expect(saved?.name).toBe('chosen.mvm')
    expect(state.closed).toBe(1)
  })

  it('answers null when the dialog is dismissed', async () => {
    vi.mocked(showSaveFilePicker).mockRejectedValue(new DOMException('no', 'AbortError'))
    await expect(provider.saveAs({}, 'My Project')).resolves.toBeNull()
  })

  // A picker throws a TypeError on a name the filesystem could not hold, which
  // would make Save As fail for a project whose name reads fine in the title
  // bar. The sanitizing happens before the picker ever sees it.
  it('suggests a filename the picker will accept', async () => {
    const { handle } = fakeFile()
    vi.mocked(showSaveFilePicker).mockResolvedValue(handle)

    const cases: [string, string][] = [
      ['My Project', 'My Project.mvm'],
      ['maps/world', 'maps world.mvm'],
      ['a\\b:c*d?e', 'a b c d e.mvm'],
      ['trailing dots...', 'trailing dots.mvm'],
      ['   ', 'Untitled Project.mvm'],
      ['CON', 'Untitled Project.mvm'],
      ['already.mvm', 'already.mvm'],
    ]

    for (const [projectName, expected] of cases) {
      await provider.saveAs({}, projectName)
      const options = vi.mocked(showSaveFilePicker).mock.calls.at(-1)?.[0]
      expect(options?.suggestedName, projectName).toBe(expected)
    }
  })

  it('strips control characters, which throw in the real picker', async () => {
    const { handle } = fakeFile()
    vi.mocked(showSaveFilePicker).mockResolvedValue(handle)

    await provider.saveAs({}, 'tab\there\u0000and null')
    const options = vi.mocked(showSaveFilePicker).mock.calls.at(-1)?.[0]
    expect(options?.suggestedName).toBe('tab here and null.mvm')
    expect(options?.suggestedName).not.toMatch(/[\u0000-\u001f]/)
  })

  it('caps a name long enough to break a filesystem', async () => {
    const { handle } = fakeFile()
    vi.mocked(showSaveFilePicker).mockResolvedValue(handle)

    await provider.saveAs({}, 'n'.repeat(5_000))
    const options = vi.mocked(showSaveFilePicker).mock.calls.at(-1)?.[0]
    expect(options!.suggestedName!.length).toBeLessThanOrEqual(130)
  })
})
