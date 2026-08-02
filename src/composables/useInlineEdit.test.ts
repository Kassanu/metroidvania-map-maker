import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useInlineEdit } from './useInlineEdit'

// Mounted for real rather than called bare: the focus/select behaviour is the
// whole point of the composable, and it only happens against a live element.
function mountEditor(initial: string, onCommit = vi.fn()) {
  let api!: ReturnType<typeof useInlineEdit>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useInlineEdit(() => initial, onCommit)
        return () =>
          api.editing.value
            ? h('input', {
                ref: api.setInputRef,
                value: api.draft.value,
                onInput: (e: Event) => (api.draft.value = (e.target as HTMLInputElement).value),
              })
            : h('button', 'label')
      },
    }),
    { attachTo: document.body },
  )
  return { wrapper, api, onCommit }
}

describe('useInlineEdit', () => {
  it('starts out not editing', () => {
    const { api } = mountEditor('Map 1')
    expect(api.editing.value).toBe(false)
  })

  it('seeds the draft from the current value on start', async () => {
    const { api } = mountEditor('Map 1')
    api.start()
    await nextTick()
    expect(api.editing.value).toBe(true)
    expect(api.draft.value).toBe('Map 1')
  })

  it('focuses and selects the existing text, so typing replaces it', async () => {
    const { wrapper, api } = mountEditor('Map 1')
    api.start()
    await nextTick()

    const input = wrapper.get('input').element
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Map 1'.length)
  })

  it('commits the trimmed draft and leaves edit mode', async () => {
    const { api, onCommit } = mountEditor('Map 1')
    api.start()
    await nextTick()
    api.draft.value = '  Caves  '
    api.commit()

    expect(onCommit).toHaveBeenCalledWith('Caves')
    expect(api.editing.value).toBe(false)
  })

  it('abandons a blank draft rather than blanking the name', async () => {
    const { api, onCommit } = mountEditor('Map 1')
    api.start()
    await nextTick()
    api.draft.value = '   '
    api.commit()

    expect(onCommit).not.toHaveBeenCalled()
    expect(api.editing.value).toBe(false)
  })

  it('commits once when the trailing blur follows Enter', async () => {
    const { api, onCommit } = mountEditor('Map 1')
    api.start()
    await nextTick()
    api.draft.value = 'Caves'

    api.commit() // Enter
    api.commit() // blur, as the input unmounts
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('cancel discards the draft without committing', async () => {
    const { api, onCommit } = mountEditor('Map 1')
    api.start()
    await nextTick()
    api.draft.value = 'Caves'
    api.cancel()

    expect(onCommit).not.toHaveBeenCalled()
    expect(api.editing.value).toBe(false)
  })

  it('re-seeds from the current value on a second edit', async () => {
    let name = 'Map 1'
    let api!: ReturnType<typeof useInlineEdit>
    mount(
      defineComponent({
        setup() {
          api = useInlineEdit(
            () => name,
            (value) => (name = value),
          )
          return () => h('div')
        },
      }),
    )

    api.start()
    api.draft.value = 'Caves'
    api.commit()

    api.start()
    expect(api.draft.value).toBe('Caves')
  })
})
