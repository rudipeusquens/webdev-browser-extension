import { describe, expect, it } from 'vitest'
import {
  isBackgroundMessage,
  isMessage,
  isOverlayMessage,
  isOverlayStatus,
  isPanelToggle,
  isPanelToggleReply,
  isPinsPointed,
} from '@/lib/messages'
import { page, snapshot } from './helpers/collection'

const S = 'http://localhost:3000'

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
    { type: 'annotation:update', site: 'http://localhost:3000', id: 'a1', comment: 'x' },
    { ...add, comment: '', draft: true },
    { ...add, draft: true },
    { type: 'annotation:update', site: S, id: 'a1', comment: 'x', keep: true },
    { type: 'annotation:update', site: S, id: 'a1', comment: '', keep: true },
    { type: 'annotation:update', site: S, id: 'a1', comment: '' },
    { type: 'annotation:remove', site: 'file://', id: 'a1' },
    { type: 'collection:clear', site: 'https://example.com' },
    { type: 'annotation:restore', site: S, id: 'a1' },
    { type: 'annotation:reopen', site: S, id: 'a1' },
    { type: 'collection:copied', site: S, ids: ['a1', 'a2'] },
    { type: 'view:set', filter: 'with-deleted' },
    { type: 'history:undo', site: S },
    { type: 'history:redo', site: 'file://' },
    { type: 'overlay:status' },
    { type: 'overlay:set-mode', mode: 'element' },
    { type: 'overlay:set-mode', mode: 'area' },
    { type: 'overlay:highlight', id: 'a1' },
    { type: 'overlay:highlight', id: null },
    { type: 'overlay:reveal', id: 'a1' },
    { type: 'overlay:set-pins', visible: false },
    { type: 'overlay:leave' },
    { type: 'site:remember', origin: 'http://localhost:3000' },
    { type: 'site:forget', origin: 'https://example.com' },
    { type: 'tab:go', tabId: 4, pageKey: 'http://localhost:3000/settings' },
    { type: 'overlay:changed', instance: 'one' },
    { type: 'overlay:failed' },
    { type: 'origin:read', selectors: ['#save'] },
    { type: 'anchors:report', pageKey: 'http://localhost:3000/', found: ['a1'], missing: [] },
    { type: 'anchors:report', pageKey: 'http://localhost:3000/', found: [], missing: ['a1', 'b2'] },
    { type: 'origin:read', selectors: Array.from({ length: 11 }, (_, i) => `#c${i}`) },
    { type: 'voice:set', model: 'openai/gpt-4o-mini-transcribe', language: 'auto', limit: 300_000 },
    { type: 'voice:set', model: 'vendor/model:free', language: 'de', limit: 10_000 },
    { type: 'voice:ready' },
    { type: 'dictation:retry', site: S, id: 'a1' },
    { type: 'dictation:dismiss', site: S, id: 'a1' },
    { type: 'note:retry', id: 'n1' },
    { type: 'note:delete', id: 'n1' },
    { type: 'voice:key:save', key: 'test-key-123' },
    { type: 'voice:key:remove' },
    { type: 'voice:key:test' },
    { type: 'settings:set', key: 'pageTitles', value: true },
    { type: 'settings:set', key: 'contextMenu', value: false },
    { type: 'tab:start', tabId: 4 },
    { type: 'collection:empty-bin', site: S },
  ])('accepts $type', (message) => {
    expect(isMessage(message)).toBe(true)
  })

  it.each([
    ['an unknown type', { type: 'annotation:delete', id: 'a1' }],
    ['a missing id', { type: 'annotation:remove', site: S }],
    ['a long id', { type: 'annotation:remove', site: S, id: 'a'.repeat(65) }],
    ['an empty pin', { ...add, comment: '  \n ' }],
    ['a draft flag that is not true', { ...add, draft: false }],
    [
      'a keep that is not true',
      { type: 'annotation:update', site: S, id: 'a1', comment: 'x', keep: 1 },
    ],
    [
      'a comment over 5000',
      { type: 'annotation:update', site: S, id: 'a1', comment: 'x'.repeat(5001) },
    ],
    ['a change without its site', { type: 'annotation:update', id: 'a1', comment: 'x' }],
    ['a site with a path', { type: 'annotation:remove', site: `${S}/a`, id: 'a1' }],
    ['a clear without its site', { type: 'collection:clear' }],
    ['a leave with extra keys', { type: 'overlay:leave', id: 'a1' }],
    ['a clear of a chrome page', { type: 'collection:clear', site: 'chrome://extensions' }],
    ['a restore without its site', { type: 'annotation:restore', id: 'a1' }],
    ['a reopen without an id', { type: 'annotation:reopen', site: S }],
    ['a copy of nothing', { type: 'collection:copied', site: S, ids: [] }],
    ['an unknown filter', { type: 'view:set', filter: 'done' }],
    ['an undo without its site', { type: 'history:undo' }],
    ['a redo of a chrome page', { type: 'history:redo', site: 'chrome://extensions' }],
    ['a filter with more', { type: 'view:set', filter: 'all', site: S }],
    ['a copy naming an id twice', { type: 'collection:copied', site: S, ids: ['a1', 'a1'] }],
    ['a copy with a bad id', { type: 'collection:copied', site: S, ids: ['a b'] }],
    [
      'a copy of 1001 items',
      { type: 'collection:copied', site: S, ids: Array.from({ length: 1001 }, (_, i) => `i${i}`) },
    ],
    ['an unknown mode', { type: 'overlay:set-mode', mode: 'text' }],
    ['pins that are not a boolean', { type: 'overlay:set-pins', visible: 'no' }],
    ['a site with a path', { type: 'site:remember', origin: 'http://localhost:3000/a' }],
    ['a file site', { type: 'site:remember', origin: 'file:///srv/app' }],
    ['a site that is no origin', { type: 'site:forget', origin: 'localhost' }],
    ['a tab id that is no integer', { type: 'tab:go', tabId: 1.5, pageKey: 'http://x.test/' }],
    ['a start without a tab', { type: 'tab:start' }],
    ['an empty bin without its site', { type: 'collection:empty-bin' }],
    ['voice settings without a limit', { type: 'voice:set', model: 'a/b', language: 'de' }],
    ['a limit of 5 s', { type: 'voice:set', model: 'a/b', language: 'de', limit: 5_000 }],
    ['a retry without its site', { type: 'dictation:retry', id: 'a1' }],
    ['a dismiss with a bad id', { type: 'dictation:dismiss', site: S, id: 'a b' }],
    ['a note retry with a site', { type: 'note:retry', site: S, id: 'n1' }],
    ['a note delete without an id', { type: 'note:delete' }],
    ['an empty bin with more', { type: 'collection:empty-bin', site: S, all: true }],
    ['a start of a tab that is no integer', { type: 'tab:start', tabId: 2.5 }],
    ['a start of no tab', { type: 'tab:start', tabId: -1 }],
    ['an unknown option', { type: 'settings:set', key: 'rememberedOrigins', value: true }],
    ['an option that is no boolean', { type: 'settings:set', key: 'pageTitles', value: 'on' }],
    ['an option with more', { type: 'settings:set', key: 'pageTitles', value: true, all: 1 }],
    ['a page that is no URL', { type: 'tab:go', tabId: 1, pageKey: 'javascript:alert(1)' }],
    ['an invalid target', { ...add, target: { kind: 'element', element: { selector: 'x' } } }],
    ['an invalid page', { ...add, page: page('chrome://settings/') }],
    ['an extra key', { type: 'collection:clear', site: S, all: true }],
    ['a change without the overlay instance', { type: 'overlay:changed' }],
    ['a change with an invalid instance', { type: 'overlay:changed', instance: 'a b' }],
    // The error stays on the page: its text may hold page content.
    ['a failure with its error', { type: 'overlay:failed', error: 'TypeError: x' }],
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
    ['a model without a vendor', { type: 'voice:set', model: 'whisper', language: 'auto' }],
    ['a language name', { type: 'voice:set', model: 'a/b', language: 'German' }],
    [
      'voice settings with an extra key',
      { type: 'voice:set', model: 'a/b', language: 'en', key: 'k' },
    ],
    ['a key with spaces', { type: 'voice:key:save', key: 'my key is here' }],
    ['a key that is too short', { type: 'voice:key:save', key: 'abc' }],
    ['a key that is no string', { type: 'voice:key:save', key: 12345678 }],
    ['a removal with a key', { type: 'voice:key:remove', key: 'test-key-123' }],
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
    expect(isBackgroundMessage({ type: 'overlay:failed' })).toBe(true)
  })
})

describe('isOverlayStatus', () => {
  it('checks the reply to overlay:status', () => {
    const status = {
      host: 'localhost:3000',
      pageKey: 'http://localhost:3000/',
      mode: 'browse',
      pins: true,
      instance: 'f00d',
    }
    expect(isOverlayStatus(status)).toBe(true)
    expect(isOverlayStatus({ ...status, instance: '' })).toBe(false)
    expect(isOverlayStatus({ ...status, instance: 'x y' })).toBe(false)
    expect(isOverlayStatus({ ...status, pins: 'yes' })).toBe(false)
    expect(isOverlayStatus({ ...status, mode: 'x' })).toBe(false)
    expect(isOverlayStatus({ ...status, host: 'x'.repeat(300) })).toBe(false)
    expect(isOverlayStatus(undefined)).toBe(false)
  })
})

describe('the toolbar toggle', () => {
  it('checks the request to an open panel', () => {
    expect(isPanelToggle({ type: 'panel:toggle', windowId: 7, tabId: 1 })).toBe(true)
    for (const bad of [
      { type: 'panel:toggle', windowId: '7', tabId: 1 },
      { type: 'panel:toggle', windowId: 7, tabId: 1.5 },
      { type: 'panel:toggle', windowId: 7 },
      { type: 'panel:toggle', windowId: 7, tabId: 1, extra: true },
      { type: 'overlay:changed' },
      null,
    ]) {
      expect(isPanelToggle(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('checks the answer of the panel', () => {
    expect(isPanelToggleReply({ closing: true })).toBe(true)
    expect(isPanelToggleReply({ closing: false })).toBe(true)
    for (const bad of [{ closing: 'yes' }, { closing: true, extra: 1 }, {}, undefined]) {
      expect(isPanelToggleReply(bad)).toBe(false)
    }
  })
})

describe('pins:pointed', () => {
  it('names a hovered and an open item, or none, and whether a popover is open', () => {
    const none = { type: 'pins:pointed', hovered: null, open: null, popover: false }
    expect(isPinsPointed({ ...none, hovered: 'a1' })).toBe(true)
    expect(isPinsPointed({ ...none, open: 'b-2', popover: true })).toBe(true)
    // A new pin's popover has no item yet.
    expect(isPinsPointed({ ...none, popover: true })).toBe(true)
    for (const bad of [
      { ...none, hovered: 'a b' },
      { type: 'pins:pointed', hovered: 'a1' },
      { type: 'pins:pointed', hovered: null, open: null },
      { ...none, popover: 'yes' },
      { ...none, text: 'x' },
      { ...none, type: 'pins:hover' },
      null,
    ]) {
      expect(isPinsPointed(bad)).toBe(false)
    }
  })
})
