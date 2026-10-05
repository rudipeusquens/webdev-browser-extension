// About 60 000 nodes of text: select-all must not freeze the tab.
const content = document.getElementById('content')
const html = []
for (let i = 0; i < 3000; i++) {
  const words = Array.from({ length: 10 }, (_, j) => `<span>word ${i}.${j}</span>`).join(' ')
  html.push(`<section class="row"><p>${words}</p></section>`)
}
content.innerHTML = html.join('')
