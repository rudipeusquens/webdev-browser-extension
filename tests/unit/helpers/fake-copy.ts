import { vi } from 'vitest'

/**
 * Chrome's copy command, as an extension with `clipboardWrite` gets it in any of its pages: it
 * fires `copy` on the document, and what a listener sets on the event replaces the clipboard.
 * happy-dom has no execCommand. `refuse` makes the command fail, as Chrome would without the
 * permission.
 */
export function fakeCopyCommand(doc: Document = document) {
  const clipboard = { text: '', refuse: false }
  const execCommand = vi.fn((command: string) => {
    if (command !== 'copy' || clipboard.refuse) return false
    const clipboardData = new DataTransfer()
    const event = new ClipboardEvent('copy', { clipboardData, cancelable: true })
    doc.dispatchEvent(event)
    if (event.defaultPrevented) clipboard.text = clipboardData.getData('text/plain')
    return true
  })
  Object.defineProperty(doc, 'execCommand', { value: execCommand, configurable: true })
  return Object.assign(clipboard, { execCommand })
}
