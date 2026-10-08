import { beforeEach, describe, expect, it } from 'vitest'
import { writeClipboard } from '@/entrypoints/sidepanel/clipboard'
import { fakeCopyCommand } from './helpers/fake-copy'

describe('writeClipboard', () => {
  let clipboard: ReturnType<typeof fakeCopyCommand>

  beforeEach(() => {
    clipboard = fakeCopyCommand()
  })

  it('puts exactly the text on the clipboard, without a selection or the focus', () => {
    document.body.innerHTML = '<button>Rec</button>'
    const button = document.querySelector('button') as HTMLButtonElement
    button.focus()
    expect(writeClipboard('  Make the header sticky.\nThen check mobile.  ')).toBe(true)
    expect(clipboard.text).toBe('  Make the header sticky.\nThen check mobile.  ')
    expect(document.activeElement).toBe(button)
  })

  it('says so when Chrome refuses the copy', () => {
    clipboard.refuse = true
    expect(writeClipboard('Hello')).toBe(false)
    expect(clipboard.text).toBe('')
  })

  it('says so when the command throws', () => {
    clipboard.execCommand.mockImplementation(() => {
      throw new Error('not allowed')
    })
    expect(writeClipboard('Hello')).toBe(false)
  })

  it('leaves later copies alone', () => {
    writeClipboard('Once')
    const event = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      cancelable: true,
    })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
