const dialog = document.getElementById('dialog')
document.getElementById('open').addEventListener('click', () => dialog.showModal())
document.getElementById('close').addEventListener('click', () => dialog.close())

// A web component with a modal dialog in a closed shadow root, as UI libraries ship them.
customElements.define(
  'shadow-dialog',
  class extends HTMLElement {
    #root = this.attachShadow({ mode: 'closed' })

    connectedCallback() {
      this.#root.innerHTML =
        '<dialog><p>Inside a web component</p><button type="button">Confirm</button></dialog>'
    }

    open() {
      this.#root.querySelector('dialog').showModal()
    }

    close() {
      this.#root.querySelector('dialog').close()
    }

    /** Center of the button in the dialog, for the tests. */
    buttonCenter() {
      const r = this.#root.querySelector('button').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
  },
)
document
  .getElementById('open-shadow')
  .addEventListener('click', () => document.querySelector('shadow-dialog').open())
