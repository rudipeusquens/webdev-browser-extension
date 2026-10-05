import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Collection, Target } from '@/lib/collection/model'
import { addAnnotation, emptyCollection, removeAnnotation } from '@/lib/collection/ops'
import { formatCollection } from '@/lib/format/markdown'
import { elementInput, page, snapshot } from './helpers/collection'

const NOW = '2026-10-05T10:00:00.000Z'
const golden = (name: string) => readFileSync(`tests/unit/golden/${name}`, 'utf8')

function collect(...items: { url: string; target: Target; comment: string; title?: string }[]) {
  return items.reduce<Collection>(
    (c, { url, target, comment, title }, i) =>
      addAnnotation(c, { id: `i${i}`, page: page(url, { title }), target, comment }, NOW),
    emptyCollection(),
  )
}

const card = (text: string) =>
  snapshot({
    selector: 'div.card',
    text,
    origin: {
      framework: 'vue',
      chain: [{ name: 'FeatureCard', file: '/srv/shop/app/components/FeatureCard.vue' }],
    },
  })

describe('formatCollection', () => {
  it('reproduces the example of spec section 7', () => {
    const c = collect(
      {
        url: 'http://localhost:3000/settings',
        title: 'Settings',
        comment: 'Make this button full width on mobile and a bit less tall.',
        target: {
          kind: 'element',
          element: {
            selector: 'form#profile > div.actions > button[type="submit"]',
            openingTag: '<button type="submit" class="h-12 px-6 rounded-md bg-primary">',
            text: 'Save changes',
            box: { x: 1180, y: 812, width: 160, height: 48 },
            styles: {
              display: 'inline-flex',
              height: '48px',
              padding: '0 24px',
              'font-size': '16px',
            },
            origin: {
              framework: 'vue',
              chain: [
                { name: 'SettingsPage', file: '/srv/shop/app/pages/settings.vue' },
                { name: 'ProfileForm', file: '/srv/shop/app/components/ProfileForm.vue' },
              ],
            },
          },
        },
      },
      {
        url: 'http://localhost:3000/settings',
        title: 'Settings',
        comment: 'Typo, should be "notifications".',
        target: {
          kind: 'text',
          selected: 'Email notifcations',
          before: '…Manage your ',
          after: ' and alerts…',
          container: snapshot({
            selector: 'section.prefs > h3',
            origin: {
              framework: 'vue',
              chain: [
                {
                  name: 'NotificationPrefs',
                  file: '/srv/shop/app/components/NotificationPrefs.vue',
                },
              ],
            },
          }),
        },
      },
      {
        url: 'http://localhost:3000/',
        title: 'Shop',
        comment: 'Spacing between these cards is uneven.',
        target: {
          kind: 'area',
          rect: { x: 120, y: 640, width: 1200, height: 420 },
          container: snapshot({
            selector: 'main > section.features',
            origin: {
              framework: 'vue',
              chain: [{ name: 'FeatureGrid', file: '/srv/shop/app/components/FeatureGrid.vue' }],
            },
          }),
          elements: [card('Fast setup'), card('Secure'), card('Support')],
          moreCount: 0,
        },
      },
    )
    expect(formatCollection(c)).toBe(golden('spec-example.md'))
  })

  it('keeps hostile page text inside its delimiters', () => {
    let c = collect(
      {
        url: 'http://localhost:3000/a_b_/?q=*x*#frag',
        title: 'Evil\r\n# Injected‮ heading <b>x</b>',
        comment: 'Two lines\nsecond line',
        target: {
          kind: 'element',
          element: {
            selector: 'div[data-x="`a``b`"]',
            openingTag: '<img src="x" onerror="alert(1)">',
            text: 'Line one\nLine two **bold** `code` "quoted" back\\slash <img src=x>',
            box: { x: 0.4, y: 10.6, width: 99.5, height: 20 },
            styles: { 'font-family': '"Evil\nFont", sans-serif' },
            origin: {
              framework: 'vue',
              chain: [{ name: 'Comp\u0007onent', file: '/srv/app/`odd`.vue', line: 7 }],
            },
          },
        },
      },
      {
        url: 'http://localhost:3000/a_b_/?q=*x*',
        comment: 'Fix the fence.',
        target: {
          kind: 'text',
          selected: '```\nfence',
          before: '…a "b" ',
          after: ' c\\',
          container: snapshot({ selector: 'p' }),
        },
      },
      {
        url: 'http://localhost:3000/a_b_/?q=*x*',
        comment: 'Too much space.',
        target: {
          kind: 'area',
          rect: { x: 0, y: 0, width: 10.2, height: 5.5 },
          container: snapshot({
            selector: 'main',
            origin: {
              framework: 'astro',
              chain: [{ file: '/srv/site/src/pages/index.astro', line: 12 }],
            },
          }),
          elements: [snapshot({ selector: 'span', text: '', styles: {} })],
          moreCount: 2,
        },
      },
    )
    // The last item to touch a page sets its info; restore the hostile title and scheme.
    const key = c.items[0]?.pageKey ?? ''
    c = {
      ...c,
      pages: {
        [key]: page('http://localhost:3000/a_b_/?q=*x*', {
          title: 'Evil\r\n# Injected‮ heading <b>x</b>',
          colorScheme: 'dark',
        }),
      },
    }
    expect(formatCollection(c)).toBe(golden('hostile-text.md'))
  })

  it('renders a multi-line comment as one blockquote', () => {
    const out = formatCollection(collect({ ...elementLine(), comment: 'First\n\nSecond' }))
    expect(out).toContain('\n\n> First\n>\n> Second\n\n')
  })

  it('keeps gaps in the numbering after a deletion', () => {
    const c = removeAnnotation(collect(elementLine(), elementLine(), elementLine()), 'i1')
    const out = formatCollection(c)
    expect(out).toContain('### 1. Element')
    expect(out).not.toContain('### 2.')
    expect(out).toContain('### 3. Element')
    expect(out.startsWith('# UI feedback: 2 items on 1 page\n')).toBe(true)
  })

  it('omits lines without data', () => {
    const element = snapshot({ text: '', styles: {} })
    const out = formatCollection(
      collect({ ...elementLine(), target: { kind: 'element', element } }),
    )
    expect(out).not.toMatch(/Text:|Styles:|Component:|unknown/)
    expect(out).toContain('- Tag: `<button type="submit">`')
  })

  it('omits an empty page title', () => {
    const out = formatCollection(collect({ ...elementLine(), title: '' }))
    expect(out).toContain('\n\nViewport: 1440×900 · Color scheme: light\n\n')
  })

  it('uses singular forms for one item on one page', () => {
    const out = formatCollection(collect(elementLine()))
    expect(out.startsWith('# UI feedback: 1 item on 1 page\n')).toBe(true)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  it('orders pages by their first item', () => {
    const c = collect(
      { ...elementLine(), url: 'http://localhost:3000/b' },
      { ...elementLine(), url: 'http://localhost:3000/a' },
      { ...elementLine(), url: 'http://localhost:3000/b' },
    )
    const out = formatCollection(c)
    expect(out.indexOf('## http://localhost:3000/b')).toBeLessThan(
      out.indexOf('## http://localhost:3000/a'),
    )
    expect(out.indexOf('### 3.')).toBeLessThan(out.indexOf('## http://localhost:3000/a'))
  })
})

function elementLine() {
  const input = elementInput('unused', 'http://localhost:3000/')
  return { url: input.page.url, target: input.target, comment: input.comment, title: 'Example' }
}
