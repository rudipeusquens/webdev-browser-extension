import type { KeyInput, Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  centerOf,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

describe('hostile pages and untrusted events', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function activate(path: string): Promise<Page> {
    await session.page.goto(`${server.origin}${path}`)
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    return panel
  }

  async function storedSelector(panel: Page) {
    const c = await waitForItems(panel, 1)
    return (c?.items[0]?.target as unknown as { element: { selector: string } }).element.selector
  }

  it('saves an item on a page with hostile CSS, a strict CSP and a top z-index layer', async () => {
    const panel = await activate('/hostile/')
    await markElement(session, '.layer')
    await session.page.keyboard.type('Remove this layer')
    await session.page.keyboard.press('Enter')
    const selector = await storedSelector(panel)
    const same = await session.page.evaluate(
      (sel) => document.querySelector(sel) === document.querySelector('.layer'),
      selector,
    )
    expect(same, selector).toBe(true)
  })

  it('marks an element inside a modal dialog', async () => {
    const panel = await activate('/modal/')
    await session.page.click('#open')
    await sleep(200)
    await markElement(session, '#inside')
    await session.page.keyboard.type('Rename to Save')
    await session.page.keyboard.press('Enter')
    const selector = await storedSelector(panel)
    const same = await session.page.evaluate(
      (sel) => document.querySelector(sel) === document.getElementById('inside'),
      selector,
    )
    expect(same, selector).toBe(true)
  })

  it('ignores mode keys and pointer events the page dispatches', async () => {
    await activate('/plain/')
    await session.page.evaluate(() => {
      for (const target of [document, window, document.body]) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
      }
    })
    await sleep(200)
    await waitInOverlay(session, '[data-testid="overlay-glass"]', false)

    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { x, y } = await centerOf(session.page, 'h1')
    await session.page.evaluate(
      (cx, cy) => {
        const host = document.querySelector('[data-e2e-host]')
        const init = { bubbles: true, composed: true, clientX: cx, clientY: cy }
        for (const target of [host, document.querySelector('h1'), document.body]) {
          target?.dispatchEvent(new PointerEvent('pointermove', init))
          target?.dispatchEvent(new MouseEvent('click', init))
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      },
      x,
      y,
    )
    await sleep(300)
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
    await waitInOverlay(session, '[data-testid="overlay-hover-label"]', false)
  })

  it('never saves or cancels a comment because of page-dispatched keys', async () => {
    const panel = await activate('/plain/')
    await markElement(session, 'h1')
    await session.page.keyboard.type('Draft')
    await session.page.evaluate(() => {
      const host = document.querySelector('[data-e2e-host]')
      for (const key of ['Enter', 'Escape']) {
        for (const target of [host, document, window]) {
          target?.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, composed: true }),
          )
        }
      }
    })
    await sleep(300)
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    expect(await storedCollection(panel)).toBeUndefined()
  })

  it('keeps a page that defines the old host name out of the shadow root', async () => {
    const panel = await activate('/taken-name/')
    await markElement(session, '#target')
    await session.page.keyboard.type('Make it blue.')
    await session.page.keyboard.press('Enter')
    const stored = await waitForItems(panel, 1)
    expect(stored?.items[0]?.comment).toBe('Make it blue.')
    expect(
      await session.page.evaluate(() => {
        const page = window as unknown as { internals?: unknown; stolen: string[] }
        return { internals: page.internals !== undefined, stolen: page.stolen }
      }),
    ).toEqual({ internals: false, stolen: [] })
  })

  it('leaves the page’s own inherited --tw-* variables alone', async () => {
    await session.page.goto(`${server.origin}/plain/inherit.html`)
    const shadow = () => session.page.$eval('#child', (el) => getComputedStyle(el).boxShadow)
    const before = await shadow()
    expect(before).toContain('rgb(255, 0, 0)')
    await clickAction(session)
    await overlayMounted(session)
    expect(await shadow()).toBe(before)
  })

  describe('a page meddling with the comment field', () => {
    type Meddling = { attack?: string; pastes?: number }

    it('saves the typed comment although the page rewrites the field on Enter', async () => {
      const panel = await activate('/meddling/')
      await markElement(session, 'h1')
      await session.page.keyboard.type('Make the heading larger.')
      await session.page.keyboard.press('Enter')
      const c = await waitForItems(panel, 1)
      expect(c?.items[0]?.comment).toBe('Make the heading larger.')
    })

    it('restores the comment when the page swaps keystrokes for its own text', async () => {
      const panel = await activate('/meddling/')
      await session.page.evaluate(() => ((window as Meddling).attack = 'typing'))
      await markElement(session, 'h1')
      await session.page.keyboard.type('Wider')
      await sleep(100)
      expect(await overlayText(session, '[data-testid="overlay-warning"]')).toContain(
        'This page tried to change your comment',
      )
      await session.page.evaluate(() => ((window as Meddling).attack = 'none'))
      await session.page.keyboard.type('OK')
      await session.page.keyboard.press('Enter')
      const c = await waitForItems(panel, 1)
      expect(c?.items[0]?.comment).toBe('OK')
    })

    it("keeps the comment when the page types the developer's key over all of it", async () => {
      const panel = await activate('/meddling/')
      await session.page.evaluate(() => ((window as Meddling).attack = 'none'))
      await markElement(session, 'h1')
      await session.page.keyboard.type('Keep all of this')
      await session.page.evaluate(() => ((window as Meddling).attack = 'replay'))
      await session.page.keyboard.type('.')
      await sleep(100)
      expect(await overlayText(session, '[data-testid="overlay-warning"]')).toContain(
        'This page tried to change your comment',
      )
      await session.page.keyboard.press('Enter')
      const c = await waitForItems(panel, 1)
      expect(c?.items[0]?.comment).toBe('Keep all of this')
    })

    /** Types `text` into a new pin's field, then turns on `attack`. */
    async function typeThenAttack(text: string, attack: string) {
      const panel = await activate('/meddling/')
      await session.page.evaluate(() => ((window as Meddling).attack = 'none'))
      await markElement(session, 'h1')
      await session.page.keyboard.type(text)
      await session.page.evaluate((a) => ((window as Meddling).attack = a), attack)
      return panel
    }

    async function saved(panel: Page) {
      await session.page.evaluate(() => ((window as Meddling).attack = 'none'))
      await session.page.keyboard.press('Enter')
      return (await waitForItems(panel, 1))?.items[0]?.comment
    }

    it("keeps the developer's Backspace where they left the caret", async () => {
      const panel = await typeThenAttack('Please do not delete the tests', 'steer')
      await session.page.keyboard.press('Backspace')
      expect(await saved(panel)).toBe('Please do not delete the test')
    })

    it('keeps a keystroke where the caret was when the page selects everything first', async () => {
      const panel = await typeThenAttack('Keep all of this', 'select-key')
      await session.page.keyboard.type('.')
      expect(await saved(panel)).toBe('Keep all of this.')
    })

    it('keeps a keystroke where the caret was when the page selects everything on its beforeinput', async () => {
      const panel = await typeThenAttack('Keep all of this', 'select-beforeinput')
      await session.page.keyboard.type('.')
      expect(await saved(panel)).toBe('Keep all of this.')
    })

    it("keeps an input method's text where the caret was when the page selects everything", async () => {
      const panel = await typeThenAttack('Keep all of this', 'select-composition')
      const cdp = await session.page.createCDPSession()
      await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
      await cdp.send('Input.insertText', { text: 'に' })
      await cdp.detach()
      expect(await saved(panel)).toBe('Keep all of thisに')
    })

    it("does not bring a restored page edit back with the browser's undo and redo", async () => {
      const panel = await typeThenAttack('mine', 'none')
      await session.page.evaluate(() => (window as unknown as { inject(): void }).inject())
      await sleep(100)
      for (const keys of [
        ['Control', 'z'],
        ['Control', 'Shift', 'z'],
      ]) {
        for (const key of keys) await session.page.keyboard.down(key as KeyInput)
        for (const key of keys.reverse()) await session.page.keyboard.up(key as KeyInput)
      }
      await session.page.keyboard.type(' ok')
      const comment = await saved(panel)
      expect(comment).not.toContain('INJECTED')
      expect(comment).toMatch(/ ok$/)
    })

    it('keeps paste events inside the comment field', async () => {
      await activate('/meddling/')
      await markElement(session, 'h1')
      await session.page.keyboard.down('Control')
      await session.page.keyboard.press('v')
      await session.page.keyboard.up('Control')
      await sleep(200)
      expect(await session.page.evaluate(() => (window as Meddling).pastes)).toBe(0)
    })
  })
})
