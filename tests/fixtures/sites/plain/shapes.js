// A web component whose text field lives in a closed shadow root.
customElements.define(
  'x-field',
  class extends HTMLElement {
    constructor() {
      super()
      const root = this.attachShadow({ mode: 'closed' })
      const input = document.createElement('input')
      input.type = 'text'
      input.setAttribute('aria-label', 'Recipe')
      root.append(input)
    }
  },
)
