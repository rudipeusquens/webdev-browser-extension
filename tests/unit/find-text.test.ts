import { describe, expect, it } from 'vitest'
import { findText } from '@/lib/capture/find-text'
import type { TextTarget } from '@/lib/collection/model'
import { snapshot } from './helpers/collection'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

const text = (selected: string, before = '', after = ''): TextTarget => ({
  kind: 'text',
  selected,
  before,
  after,
  container: snapshot({ selector: 'p' }),
})

/** Where the found range starts: the text before it inside `root`. */
function startOf(range: Range | null, root: Element): number {
  if (!range) return -1
  const lead = document.createRange()
  lead.setStart(root, 0)
  lead.setEnd(range.startContainer, range.startOffset)
  return lead.toString().length
}

describe('findText', () => {
  it('finds the selected text in its container', () => {
    document.body.innerHTML = '<p>Choose how often we contact you. Changes apply right away.</p>'
    const range = findText($('p'), text('contact you', 'Choose how often we ', '. Changes apply'))
    expect(range?.toString()).toBe('contact you')
  })

  it('takes the occurrence whose context fits best', () => {
    document.body.innerHTML =
      '<p>We may contact you rarely. Choose how often we contact you. Changes apply right away.</p>'
    const range = findText($('p'), text('contact you', 'Choose how often we ', '. Changes apply'))
    expect(range?.toString()).toBe('contact you')
    expect(startOf(range, $('p'))).toBe('We may contact you rarely. Choose how often we '.length)
  })

  it('takes the first occurrence when the context fits none better', () => {
    document.body.innerHTML = '<p>one two one two</p>'
    expect(startOf(findText($('p'), text('two', 'zzz', 'yyy')), $('p'))).toBe(4)
  })

  it('finds a cut selection by its part before the …', () => {
    document.body.innerHTML = `<p>Start ${'long words '.repeat(80)}end</p>`
    const cut = `${`Start ${'long words '.repeat(80)}`.slice(0, 499)}…`
    const range = findText($('p'), text(cut))
    expect(range?.toString()).toBe(cut.slice(0, -1).trimEnd())
  })

  it('matches across inline elements, line breaks and other white space', () => {
    document.body.innerHTML = '<p>Manage   your\n  <b>Email</b>\n<i>notifcations</i> and alerts</p>'
    const range = findText($('p'), text('your Email notifcations', 'Manage ', ' and alerts'))
    expect(range?.toString().replace(/\s+/g, ' ')).toBe('your Email notifcations')
  })

  it('finds text written with joiners', () => {
    document.body.innerHTML = '<p>Persian: می\u200Cخواهم. Emoji: 👩\u200D💻 at work.</p>'
    expect(findText($('p'), text('می\u200Cخواهم'))?.toString()).toBe('می\u200Cخواهم')
    expect(findText($('p'), text('👩\u200D💻 at work'))?.toString()).toBe('👩\u200D💻 at work')
  })

  // Pins stored before invisible characters were removed on capture still hold them.
  it('finds a selection stored with invisible characters the page text still has', () => {
    document.body.innerHTML = '<p>Pick a well\u00ADknown name\u200B here.</p>'
    const stored = text('well\u00ADknown name\u200B', 'Pick a ', ' here.')
    expect(findText($('p'), stored)?.toString()).toBe('well\u00ADknown name')
  })

  it('is null when the text is not there anymore', () => {
    document.body.innerHTML = '<p>Choose how often we reach out.</p>'
    expect(findText($('p'), text('contact you'))).toBeNull()
    expect(findText($('p'), text(''))).toBeNull()
  })

  it('never matches text inside form fields, scripts or hidden elements', () => {
    document.body.innerHTML =
      '<p><textarea>contact you</textarea><script>"contact you"</script>' +
      '<span style="display: none">contact you</span>Visible</p>'
    expect(findText($('p'), text('contact you'))).toBeNull()
  })

  it('searches only the start of one huge text node', () => {
    const filler = 'log line '.repeat(400_000)
    document.body.innerHTML = `<pre>early needle ${filler} late needle</pre>`
    expect(findText($('pre'), text('early needle'))?.toString()).toBe('early needle')
    const started = performance.now()
    expect(findText($('pre'), text('late needle'))).toBeNull()
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('stays within its budget on a huge container', () => {
    document.body.innerHTML = `<p>${'<i>filler</i>'.repeat(20000)}<b>needle</b></p>`
    const started = performance.now()
    expect(findText($('p'), text('needle'))).toBeNull()
    expect(performance.now() - started).toBeLessThan(5000)
  })
})
