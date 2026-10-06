// The key Chrome assigned to the toolbar action. The developer can change or remove it in
// chrome://extensions/shortcuts, and Chrome assigns none when the key is taken.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { browser } from 'wxt/browser'

/** As Chrome shows it (`Ctrl+Shift+K`, `⇧⌘K`); empty when there is none. */
export function useShortcut(): { shortcut: Ref<string> } {
  const shortcut = ref('')
  let latest = 0

  async function read() {
    const run = ++latest
    let next = ''
    try {
      const commands = await browser.commands.getAll()
      next = commands.find((c) => c.name === '_execute_action')?.shortcut ?? ''
    } catch {
      // No shortcut to name.
    }
    // An older read must not overwrite a newer one.
    if (run === latest) shortcut.value = next
  }

  // Shortcuts change in a tab of their own: read again when the developer comes back.
  const onActivated = () => void read()

  onMounted(() => {
    browser.tabs.onActivated.addListener(onActivated)
    void read()
  })
  onBeforeUnmount(() => browser.tabs.onActivated.removeListener(onActivated))

  return { shortcut }
}
