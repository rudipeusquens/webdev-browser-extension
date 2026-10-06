// One huge text node, like a log or a JSON dump in a <pre>.
document.getElementById('log').textContent =
  `First entry of the log\n${'Another line of the log output\n'.repeat(70000)}`

// Changes the DOM on every frame, like a page with a timer, a ticker and a live feed.
let ticks = 0
setInterval(() => {
  ticks++
  document.getElementById('ticks').textContent = String(ticks)
  const feed = document.getElementById('feed')
  const item = document.createElement('li')
  item.textContent = `Event ${ticks}`
  feed.prepend(item)
  if (feed.children.length > 20) feed.lastElementChild.remove()
}, 16)
