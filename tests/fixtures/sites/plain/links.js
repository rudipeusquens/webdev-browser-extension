// Counts the clicks the page receives on its links and on the card.
window.linkClicks = 0
window.cardClicks = 0
for (const link of document.querySelectorAll('a')) {
  link.addEventListener('click', () => {
    window.linkClicks++
  })
}
document.getElementById('card').addEventListener('click', () => {
  window.cardClicks++
})
