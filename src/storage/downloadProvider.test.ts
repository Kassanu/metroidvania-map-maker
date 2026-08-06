import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '@/core/storage/provider'
import type { StorageHandle } from '@/core/storage/provider'
import { LIMITS } from '@/core/serialize/limits'
import { DOWNLOAD_PROVIDER_ID, createDownloadProvider } from './downloadProvider'

const provider = createDownloadProvider()

// jsdom implements neither object URLs nor a real download, so both are
// recorded rather than performed. Everything else here is the real DOM.
let objectUrls: { created: number; revoked: string[] }
let downloads: { name: string; blob: Blob }[]

beforeEach(() => {
  objectUrls = { created: 0, revoked: [] }
  downloads = []
  let lastBlob: Blob | null = null

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      lastBlob = blob
      objectUrls.created += 1
      return `blob:fake/${objectUrls.created}`
    }),
    revokeObjectURL: vi.fn((url: string) => objectUrls.revoked.push(url)),
  })

  // An anchor click is what triggers the save, so it is intercepted at the
  // prototype rather than mocked away: the element is really built and really
  // appended, and only the navigation is stopped.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: lastBlob! })
  })

  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Drives the hidden input the way a user picking a file does. The provider
// creates it, clicks it, and waits; this finds it and answers.
function answerPicker(file: File | null) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    queueMicrotask(() => {
      if (file) {
        Object.defineProperty(this, 'files', { value: [file], configurable: true })
        this.dispatchEvent(new Event('change'))
      } else {
        this.dispatchEvent(new Event('cancel'))
      }
    })
  })
}

function mvmFile(contents: string, name = 'world.mvm', size?: number): File {
  const file = new File([contents], name, { type: 'application/x-mvm+json' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('it announces what it cannot do', () => {
  it('does not claim to save in place', () => {
    expect(provider.canSaveInPlace).toBe(false)
  })

  it('has nothing to enumerate', async () => {
    expect(await provider.list()).toEqual([])
  })

  // Declined outright, rather than answered with a handle that would then be
  // refused a line later by `open`. The caller reads null as "not for me" and
  // says nothing; a handle would surface as a failure the user cannot act on.
  it('declines a file the operating system launched the app with', () => {
    const launched = { name: 'launched.mvm' } as FileSystemFileHandle
    expect(provider.adoptFileHandle(launched)).toBeNull()
  })

  it('keeps nothing when asked to remember or forget', async () => {
    const handle = { providerId: DOWNLOAD_PROVIDER_ID, name: 'world.mvm' } as StorageHandle
    await provider.remember(handle)
    expect(await provider.list()).toEqual([])
    await expect(provider.forget(handle)).resolves.toBeUndefined()
  })

  // Silently showing a picker would open something other than what was asked
  // for, which is worse than refusing.
  it('refuses to reopen a handle it never really issued', async () => {
    const handle = { providerId: DOWNLOAD_PROVIDER_ID, name: 'world.mvm' } as StorageHandle
    await expect(provider.open(handle)).rejects.toThrow(StorageError)
  })
})

describe('open', () => {
  it('reads the picked file and names the handle after it', async () => {
    answerPicker(mvmFile('{"format":"x","version":2}'))
    const opened = await provider.open()

    expect(opened?.data).toEqual({ format: 'x', version: 2 })
    expect(opened?.handle.name).toBe('world.mvm')
    expect(opened?.handle.providerId).toBe(DOWNLOAD_PROVIDER_ID)
  })

  it('answers null when the dialog is dismissed', async () => {
    answerPicker(null)
    await expect(provider.open()).resolves.toBeNull()
  })

  it('leaves no input behind on either path', async () => {
    answerPicker(mvmFile('{}'))
    await provider.open()
    answerPicker(null)
    await provider.open()
    expect(document.querySelectorAll('input[type=file]')).toHaveLength(0)
  })

  it('offers the literal extension, which is what a file dialog matches on', async () => {
    let accept = ''
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      accept = this.accept
      queueMicrotask(() => this.dispatchEvent(new Event('cancel')))
    })
    await provider.open()
    expect(accept).toContain('.mvm')
  })

  it('refuses a file past the byte cap before reading it', async () => {
    const text = vi.fn()
    const file = mvmFile('{}', 'huge.mvm', LIMITS.bytes + 1)
    Object.defineProperty(file, 'text', { value: text })
    answerPicker(file)

    await expect(provider.open()).rejects.toThrow(StorageError)
    expect(text).not.toHaveBeenCalled()
  })

  it('turns unreadable bytes into a StorageError', async () => {
    answerPicker(mvmFile('{ truncated'))
    await expect(provider.open()).rejects.toThrow(StorageError)
  })
})

describe('save', () => {
  it('downloads under the name the file was opened as', async () => {
    const handle = { providerId: DOWNLOAD_PROVIDER_ID, name: 'world.mvm' } as StorageHandle
    const saved = await provider.save(handle, { format: 'x' })

    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('world.mvm')
    expect(saved.name).toBe('world.mvm')
    expect(JSON.parse(await downloads[0].blob.text())).toEqual({ format: 'x' })
  })

  it('sanitizes a name that came from a project title', async () => {
    await provider.saveAs({}, 'maps/world: final?')
    expect(downloads[0].name).toBe('maps world final.mvm')
  })

  // A handle's name has always been through a real file dialog or through
  // `safeFileName` already, so this cannot currently be reached. It is here
  // because `download` is one anchor attribute away from writing whatever it
  // is handed, and a future provider or a restored handle is not bound by
  // today's guarantee.
  it('sanitizes a handle name too, however it got there', async () => {
    const handle = { providerId: DOWNLOAD_PROVIDER_ID, name: '../../etc/passwd' } as StorageHandle
    await provider.save(handle, {})
    expect(downloads[0].name).toBe('etc passwd.mvm')
  })

  it('adds the extension when the name lacks one', async () => {
    await provider.saveAs({}, 'My Project')
    expect(downloads[0].name).toBe('My Project.mvm')
  })

  it('leaves no anchor behind', async () => {
    await provider.saveAs({}, 'My Project')
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  // Revoking straight away cancels the download in some engines, so the URL
  // has to outlive the click.
  it('holds the object URL open past the click', async () => {
    await provider.saveAs({}, 'My Project')
    expect(objectUrls.created).toBe(1)
    expect(objectUrls.revoked).toEqual([])

    vi.runOnlyPendingTimers()
    expect(objectUrls.revoked).toEqual(['blob:fake/1'])
  })
})
