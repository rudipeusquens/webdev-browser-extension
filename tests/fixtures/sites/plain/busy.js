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
