// Every named image or form becomes a property of `document` that hides the real member
// (`Document` has [LegacyOverrideBuiltIns]). Not shadowed here: what WXT itself needs to
// mount the overlay (querySelector, createElement, head, add/removeEventListener,
// dispatchEvent), which is a documented limit.
const NAMES = [
  'title',
  'body',
  'documentElement',
  'defaultView',
  'activeElement',
  'scrollingElement',
  'getSelection',
  'elementsFromPoint',
  'querySelectorAll',
]
for (const [i, name] of NAMES.entries()) {
  const el = document.createElement(i % 2 ? 'form' : 'img')
  el.setAttribute('name', name)
  document.body.append(el)
}
window.clobbered = NAMES.filter((name) => document[name] instanceof Element)
