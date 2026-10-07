// `window.cover()` opens a popover inside a closed shadow root over the whole viewport: its
// toggle event stays in that root, and clicks go through it (`pointer-events: none`). It
// opens itself again above anything else that opens, so it stays on top. `window.uncover()`
// takes it away. `window.coverUntilPress()` covers until a pointer is pressed: the click that
// follows lands on what the developer did not see. `window.tooltip()` opens a small popover
// of a web component in a corner, as a tooltip does: it covers nothing.
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

window.coverUntilPress = () => {
  window.cover()
  window.addEventListener('pointerdown', () => window.uncover(), { capture: true, once: true })
}

window.tooltip = () => {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const tip = document.createElement('div')
  tip.setAttribute('popover', 'manual')
  tip.textContent = 'A tooltip'
  tip.style.cssText = 'position: fixed; inset: auto 8px 8px auto; margin: 0;'
  root.append(tip)
  document.body.append(host)
  tip.showPopover()
}
