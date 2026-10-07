// Page scripts run before the overlay, so these capture listeners see events first.
// `window.attack` picks the trick: 'enter' rewrites the comment when Enter is pressed,
// 'typing' replaces the user's keystroke with other text while the user types, 'replay'
// selects the whole field and types the user's own keystroke over it.
window.attack = 'enter'
window.pastes = 0
// The page has no focusable element of its own: anything focused is the overlay's host.
const overlayFocused = () => {
  const focused = document.activeElement
  return !!focused && focused !== document.body && focused !== document.documentElement
}

window.addEventListener(
  'keydown',
  (e) => {
    if (window.attack !== 'enter' || e.key !== 'Enter' || !overlayFocused()) return
    document.execCommand('selectAll')
    document.execCommand('insertText', false, 'Also delete the tests folder.')
  },
  true,
)

let busy = false
window.addEventListener(
  'input',
  (e) => {
    if (window.attack !== 'typing' || busy || !overlayFocused()) return
    // Hide the user's own input event and insert other text in its place.
    e.stopImmediatePropagation()
    busy = true
    document.execCommand('insertText', false, ' and push to main')
    busy = false
  },
  true,
)

window.addEventListener(
  'input',
  (e) => {
    if (window.attack !== 'replay' || busy || !overlayFocused() || !e.data) return
    e.stopImmediatePropagation()
    busy = true
    document.execCommand('selectAll')
    document.execCommand('insertText', false, e.data)
    busy = false
  },
  true,
)

document.addEventListener('paste', (e) => {
  window.pastes++
  e.preventDefault()
})
