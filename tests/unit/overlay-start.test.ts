import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'

// How the overlay entry starts and reports a failed start (spec section 12), with WXT's UI
// helper, the top layer and the Overlay component replaced: they need a real browser.
const state = vi.hoisted(() => ({ failIn: null as null | 'setup' | 'mounted' | 'ui' }))

// Vue's production build, as the extension runs it: it logs errors in setup, render and hooks
// instead of throwing them. Tests otherwise get the development build, which throws.
// The file has no type declarations of its own; it is the same API.
vi.mock('vue', () => import('vue/dist/vue.runtime.esm-browser.prod.js' as string))

vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({
  createShadowRootUi: async (
    _ctx: unknown,
    options: {
      onMount: (container: Element, shadow: ShadowRoot, host: HTMLElement) => unknown
      onRemove?: (mounted: unknown) => void
    },
  ) => {
    if (state.failIn === 'ui') throw new Error('NotSupportedError')
    const host = document.createElement('webdev-overlay')
    const shadow = host.attachShadow({ mode: 'open' })
    const container = document.createElement('div')
    shadow.append(container)
    let mounted: unknown
    return {
      shadow,
      mount() {
        document.body.append(host)
        mounted = options.onMount(container, shadow, host)
      },
      remove() {
        options.onRemove?.(mounted)
        host.remove()
      },
    }
  },
}))

vi.mock('@/entrypoints/overlay.content/top-layer', () => ({
  keepOnTop: () => ({ contain: () => undefined, stop: () => undefined }),
}))

vi.mock('@/entrypoints/overlay.content/Overlay.vue', async () => {
  const { defineComponent, h, onMounted } = await import('vue')
  return {
    default: defineComponent({
      setup() {
        if (state.failIn === 'setup') throw new Error('setup failed')
        onMounted(() => {
          if (state.failIn === 'mounted') throw new Error('mounted failed')
        })
        return () => h('div', { 'data-testid': 'overlay-root' })
      },
    }),
  }
})

const { default: overlay } = await import('@/entrypoints/overlay.content/index')
const ctx = { onInvalidated: vi.fn(), setInterval: vi.fn() } as never

describe('starting the overlay', () => {
  it('runs on the production build of Vue', async () => {
    const { createApp } = await import('vue')
    const failing = {
      setup() {
        throw new Error('setup failed')
      },
    }
    // Logged, not thrown.
    expect(() => createApp(failing).mount(document.createElement('div'))).not.toThrow()
  })

  let logged: ReturnType<typeof vi.spyOn>
  let sent: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fakeBrowser.reset()
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sent = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    state.failIn = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('mounts and reports nothing', async () => {
    await overlay.main(ctx)
    expect(document.querySelectorAll('webdev-overlay')).toHaveLength(1)
    expect(sent).not.toHaveBeenCalled()
  })

  it.each(['ui', 'setup', 'mounted'] as const)(
    'reports a failure in %s, logs it on the page and leaves nothing behind',
    async (where) => {
      state.failIn = where
      await overlay.main(ctx)
      expect(sent).toHaveBeenCalledWith({ type: 'overlay:failed' })
      expect(logged).toHaveBeenCalledWith(
        'Webdev Browser Extension: The overlay could not start on this page.',
        expect.any(Error),
      )
      expect(document.querySelectorAll('webdev-overlay')).toHaveLength(0)
    },
  )
})
