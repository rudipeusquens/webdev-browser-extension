// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeContextMenus } from './helpers/fake-context-menus'
import { fakeSites } from './helpers/fake-sites'

// The background runs in a service worker: no DOM. A module it imports that touches
// `Element` or `document` when it loads stops the whole background.
describe('the background in a service worker', () => {
  it('loads and starts without a DOM', async () => {
    expect(typeof globalThis.Element).toBe('undefined')
    fakeSites()
    fakeContextMenus()
    const { default: background } = await import('@/entrypoints/background')
    expect(() => background.main()).not.toThrow()
  })
})
