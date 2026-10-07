// `window.cover()` opens a popover inside a closed shadow root over the whole viewport: its
// toggle event stays in that root, and clicks go through it (`pointer-events: none`). It
// opens itself again above anything else that opens, so it stays on top. `window.uncover()`
// takes it away.
let cover = null

function raise(event) {
  if (cover && event.target !== cover.host && event.newState === 'open') {
    cover.panel.hidePopover()
    cover.panel.showPopover()
  }
}

window.cover = () => {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'closed' })
  const panel = document.createElement('div')
  panel.setAttribute('popover', 'manual')
  panel.style.cssText =
    'position: fixed; inset: 0; width: 100vw; height: 100vh; margin: 0; padding: 0; ' +
    'border: 0; background: rgba(255, 255, 255, 0.01); pointer-events: none;'
  root.append(panel)
  document.body.append(host)
  panel.showPopover()
  cover = { host, panel }
  document.addEventListener('toggle', raise, true)
}

window.uncover = () => {
  document.removeEventListener('toggle', raise, true)
  cover?.host.remove()
  cover = null
}
