import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { readOrigins, sourcesOf, within, withOrigins } from '@/entrypoints/overlay.content/origins'
import type { AreaTarget, CodeOrigin, Target } from '@/lib/collection/model'
import { snapshot } from './helpers/collection'

const card: CodeOrigin = {
  framework: 'vue',
  chain: [{ name: 'Card', file: '/srv/app/src/components/Card.vue' }],
}
const area: AreaTarget = {
  kind: 'area',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  container: snapshot({ selector: 'section' }),
  elements: [snapshot({ selector: '#a' }), snapshot({ selector: '#b' })],
  moreCount: 0,
}

beforeEach(() => {
  fakeBrowser.reset()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sourcesOf and withOrigins', () => {
  it("pair an area's container and elements with their origins in order", () => {
    const els = [document.createElement('section'), document.createElement('div')]
    expect(sourcesOf(area, els)).toEqual({ elements: els, selectors: ['section', '#a', '#b'] })
    const next = withOrigins(area, [undefined, card, undefined]) as AreaTarget
    expect(next.container.origin).toBeUndefined()
    expect(next.elements.map((el) => el.origin)).toEqual([card, undefined])
    expect('origin' in (next.elements[1] ?? {})).toBe(false)
  })

  it('put the origin on the element or the text container', () => {
    const element: Target = { kind: 'element', element: snapshot() }
    expect(withOrigins(element, [card])).toEqual({
      kind: 'element',
      element: { ...snapshot(), origin: card },
    })
    const text: Target = {
      kind: 'text',
      selected: 'x',
      before: '',
      after: '',
      container: snapshot({ selector: 'h3' }),
    }
    expect(sourcesOf(text, []).selectors).toEqual(['h3'])
    expect(withOrigins(text, [card])).toMatchObject({ container: { origin: card } })
  })
})

describe('readOrigins', () => {
  it("takes Vue's answer, adds the inspector line, and falls back to Astro attributes", async () => {
    document.body.innerHTML =
      '<button data-v-inspector="src/components/Card.vue:9:3">Go</button>' +
      '<p data-astro-source-file="/srv/site/src/Hero.astro" data-astro-source-loc="2:1">Hi</p>'
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValue({ ok: true, origins: [card, null] } as never)
    const elements = [document.querySelector('button'), document.querySelector('p')] as Element[]
    expect(await readOrigins({ elements, selectors: ['button', 'p'] })).toEqual([
      { framework: 'vue', chain: [{ ...card.chain[0], line: 9 }] },
      { framework: 'astro', chain: [{ file: '/srv/site/src/Hero.astro', line: 2 }] },
    ])
    expect(send).toHaveBeenCalledWith({ type: 'origin:read', selectors: ['button', 'p'] })
  })

  it('keeps the attributes when the background fails or answers for other selectors', async () => {
    document.body.innerHTML = '<p data-astro-source-file="/srv/site/src/Hero.astro">Hi</p>'
    const elements = [document.querySelector('p') as Element]
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
    for (const reply of [
      Promise.reject(new Error('Extension context invalidated.')),
      Promise.resolve({ ok: false, error: 'x' }),
      Promise.resolve({ ok: true, origins: [card, card] }),
    ]) {
      send.mockReturnValueOnce(reply as never)
      expect(await readOrigins({ elements, selectors: ['p'] })).toEqual([
        { framework: 'astro', chain: [{ file: '/srv/site/src/Hero.astro' }] },
      ])
    }
  })
})

describe('within', () => {
  it('gives the value in time and undefined when it is late', async () => {
    vi.useFakeTimers()
    expect(await within(Promise.resolve(1), 100)).toBe(1)
    const late = within(new Promise(() => undefined), 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await late).toBeUndefined()
    const past = within(new Promise(() => undefined), -50)
    await vi.advanceTimersByTimeAsync(0)
    expect(await past).toBeUndefined()
  })
})
