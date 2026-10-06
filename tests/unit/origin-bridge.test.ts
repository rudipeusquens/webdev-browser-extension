import { beforeEach, describe, expect, it } from 'vitest'
import { vueOrigins } from '@/lib/capture/origin-bridge'

interface Instance {
  type: unknown
  parent: Instance | null
}

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

/** What Vue's dev build puts on the elements it renders, non-enumerable. */
function rendered(el: Element, instance: unknown) {
  Object.defineProperty(el, '__vueParentComponent', { value: instance, configurable: true })
}

const app: Instance = { type: { name: 'App', __file: '/srv/app/src/App.vue' }, parent: null }
const card: Instance = {
  type: { __name: 'Card', name: 'Ignored', __file: '/srv/app/src/components/Card.vue' },
  parent: app,
}

beforeEach(() => {
  document.body.innerHTML =
    '<main><div class="card"><button>Go</button><span>Raw</span></div></main>'
  rendered($('main'), app)
  rendered($('.card'), card)
  rendered($('button'), card)
})

describe('vueOrigins', () => {
  it('returns the component chain of each element, outermost first', () => {
    expect(vueOrigins(['.card > button', 'main'])).toEqual([
      {
        chain: [
          { name: 'App', file: '/srv/app/src/App.vue' },
          { name: 'Card', file: '/srv/app/src/components/Card.vue' },
        ],
      },
      { chain: [{ name: 'App', file: '/srv/app/src/App.vue' }] },
    ])
  })

  it('takes the instance of the nearest ancestor for elements Vue did not render', () => {
    expect(vueOrigins(['span'])[0]?.chain.at(-1)?.name).toBe('Card')
  })

  it('gives null for selectors that throw or match nothing, and outside Vue', () => {
    document.body.insertAdjacentHTML('beforeend', '<p>Plain</p>')
    expect(vueOrigins(['div[[', '#missing', 'p'])).toEqual([null, null, null])
  })

  it('stops following a cyclic parent chain', () => {
    const loop: Instance = { type: { name: 'Loop', __file: '/l.vue' }, parent: null }
    loop.parent = loop
    rendered($('button'), loop)
    expect(vueOrigins(['button'])[0]?.chain).toHaveLength(32)
  })

  it('gives null for one element whose instance throws, and still reads the others', () => {
    Object.defineProperty($('button'), '__vueParentComponent', {
      get() {
        throw new Error('page says no')
      },
      configurable: true,
    })
    const [button, main] = vueOrigins(['button', 'main'])
    expect(button).toBeNull()
    expect(main?.chain).toHaveLength(1)
  })

  it('cuts long strings and passes on only strings', () => {
    rendered($('button'), {
      type: { __name: 42, name: { evil: true }, __file: `/${'x'.repeat(1_000_000)}` },
      parent: null,
    })
    const [origin] = vueOrigins(['button'])
    expect(origin?.chain[0]?.name).toBeUndefined()
    expect(origin?.chain[0]?.file).toHaveLength(1000)
  })

  it('needs nothing from outside its own body, so it can run in the page', () => {
    const source = vueOrigins.toString()
    expect(source).not.toMatch(/\bimport\b|__vite|require\(|_interop|__name\(/)
  })
})
