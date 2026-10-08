// Writing the clipboard without the focus the Clipboard API asks for (spec section 8): Rec's
// text arrives seconds after the click, when the developer may be in the agent's window
// already. The copy command works in an unfocused page of an extension with `clipboardWrite`;
// the text goes in through the copy event, so no field is selected and the focus stays.

/** Puts `text` on the clipboard as plain text; false when Chrome refuses. */
export function writeClipboard(text: string): boolean {
  let written = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    written = true
  }
  document.addEventListener('copy', onCopy)
  try {
    return document.execCommand('copy') && written
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy)
  }
}
