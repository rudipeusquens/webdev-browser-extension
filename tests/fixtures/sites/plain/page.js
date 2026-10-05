// Counts clicks the page receives; element mode must swallow them.
window.pageClicks = 0
document.addEventListener('click', () => {
  window.pageClicks++
})
