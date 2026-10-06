import { describe, expect, it } from 'vitest'
import { isBackgroundMessage, isMessage, isOverlayMessage, isOverlayStatus } from '@/lib/messages'
import { page, snapshot } from './helpers/collection'

const add = {
  type: 'annotation:add',
  id: 'a1',
  page: page('http://localhost:3000/'),
  target: { kind: 'element', element: snapshot() },
  comment: 'Make it wider.',
}

describe('isMessage', () => {
  it.each([
    add,
    { type: 'annotation:update', id: 'a1', comment: 'x' },
    { type: 'annotation:remove', id: 'a1' },
    { type: 'collection:clear' },
    { type: 'overlay:status' },
    { type: 'overlay:set-mode', mode: 'element' },
    { type: 'overlay:set-mode', mode: 'area' },
    { type: 'overlay:highlight', id: 'a1' },
    { type: 'overlay:highlight', id: null },
    { type: 'overlay:reveal', id: 'a1' },
    { type: 'overlay:set-pins', visible: false },
    { type: 'overlay:changed' },
    { type: 'origin:read', selectors: ['#save'] },
    { type: 'anchors:report', pageKey: 'http://localhost:3000/', found: ['a1'], missing: [] },
    { type: 'anchors:report', pageKey: 'http://localhost:3000/', found: [], missing: ['a1', 'b2'] },
    { type: 'origin:read', selectors: Array.from({ length: 11 }, (_, i) => `#c${i}`) },
  ])('accepts $type', (message) => {
    expect(isMessage(message)).toBe(true)
  })

  it.each([
    ['an unknown type', { type: 'annotation:delete', id: 'a1' }],
    ['a missing id', { type: 'annotation:remove' }],
    ['a long id', { type: 'annotation:remove', id: 'a'.repeat(65) }],
    ['an empty comment', { type: 'annotation:update', id: 'a1', comment: '  \n ' }],
    ['a comment over 5000', { type: 'annotation:update', id: 'a1', comment: 'x'.repeat(5001) }],
    ['an unknown mode', { type: 'overlay:set-mode', mode: 'text' }],
    ['pins that are not a boolean', { type: 'overlay:set-pins', visible: 'no' }],
    ['an invalid target', { ...add, target: { kind: 'element', element: { selector: 'x' } } }],
    ['an invalid page', { ...add, page: page('chrome://settings/') }],
    ['an extra key', { type: 'collection:clear', all: true }],
    ['no selectors', { type: 'origin:read', selectors: [] }],
    ['12 selectors', { type: 'origin:read', selectors: Array.from({ length: 12 }, () => 'b') }],
    ['a selector that is not a string', { type: 'origin:read', selectors: [42] }],
    ['an empty selector', { type: 'origin:read', selectors: [''] }],
    ['a selector over 1000', { type: 'origin:read', selectors: ['b'.repeat(1001)] }],
    ['selectors that are not a list', { type: 'origin:read', selectors: '#save' }],
    ['an extra key on origin:read', { type: 'origin:read', selectors: ['b'], frame: 1 }],
    [
      'a report with an invalid id',
      { type: 'anchors:report', pageKey: 'http://x.test/', found: ['a b'], missing: [] },
    ],
    [
      'a report for a page that is no URL',
      { type: 'anchors:report', pageKey: 'chrome://settings/', found: [], missing: [] },
    ],
    [
      'a report with too many ids',
      {
        type: 'anchors:report',
        pageKey: 'http://x.test/',
        found: Array.from({ length: 1001 }, (_, i) => `a${i}`),
        missing: [],
      },
    ],
    ['null', null],
    ['a string', 'collection:clear'],
    ['an array', [{ type: 'collection:clear' }]],
  ])('rejects %s', (_, message) => {
    expect(isMessage(message)).toBe(false)
  })
})

describe('message groups', () => {
  it('separates background and overlay messages', () => {
    expect(isBackgroundMessage(add)).toBe(true)
    expect(isOverlayMessage(add)).toBe(false)
    expect(isBackgroundMessage({ type: 'overlay:status' })).toBe(false)
    expect(isOverlayMessage({ type: 'overlay:status' })).toBe(true)
    expect(isOverlayMessage({ type: 'overlay:changed' })).toBe(false)
  })
})

describe('isOverlayStatus', () => {
  it('checks the reply to overlay:status', () => {
    const status = {
      host: 'localhost:3000',
      pageKey: 'http://localhost:3000/',
      mode: 'browse',
      pins: true,
    }
    expect(isOverlayStatus(status)).toBe(true)
    expect(isOverlayStatus({ ...status, pins: 'yes' })).toBe(false)
    expect(isOverlayStatus({ ...status, mode: 'x' })).toBe(false)
    expect(isOverlayStatus({ ...status, host: 'x'.repeat(300) })).toBe(false)
    expect(isOverlayStatus(undefined)).toBe(false)
  })
})
