// A single-page app: links change the URL with pushState and render another page without a
// reload; back and forward render the page of the URL.
const PAGES = {
  a: { title: 'Page A', button: 'Alpha action' },
  b: { title: 'Page B', button: 'Beta action' },
  c: { title: 'Page C', button: 'Gamma action' },
}

function render() {
  const name = new URLSearchParams(location.search).get('page') ?? 'a'
  const page = PAGES[name] ?? PAGES.a
  document.title = page.title
  const content = document.getElementById('content')
  content.replaceChildren()
  const heading = document.createElement('h1')
  heading.textContent = page.title
  const button = document.createElement('button')
  button.type = 'button'
  button.id = `${name}-button`
  button.textContent = page.button
  content.append(heading, button)
}

window.navigateTo = (name) => {
  history.pushState(null, '', `?page=${name}`)
  render()
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-page]')
  if (!link) return
  event.preventDefault()
  window.navigateTo(link.dataset.page)
})
addEventListener('popstate', render)
render()
