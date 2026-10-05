// A script focus trap like the focus scopes of Radix and reka-ui: focus that leaves the
// container is pulled back. `?plain` drops the dialog roles, as some home-made traps do.
const container = document.getElementById('trap')
if (location.search.includes('plain')) {
  container.removeAttribute('role')
  container.removeAttribute('aria-modal')
}
window.submits = 0
document.getElementById('confirm').addEventListener('submit', (e) => {
  e.preventDefault()
  window.submits++
})
let last = document.getElementById('ok')
last.focus()
document.addEventListener('focusin', (e) => {
  if (container.contains(e.target)) last = e.target
  else last.focus()
})
document.addEventListener('focusout', (e) => {
  if (e.relatedTarget && !container.contains(e.relatedTarget)) last.focus()
})
