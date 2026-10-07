import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  // Explicit imports keep every module readable on its own.
  imports: false,
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Webdev Browser Extension',
    description:
      'Mark elements, text and areas on a page and copy them as a prompt for an AI coding agent.',
    minimum_chrome_version: '116',
    // No other extension and no page may message the extension.
    externally_connectable: { ids: [] },
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'offscreen',
      'clipboardWrite',
      'contextMenus',
      'unlimitedStorage',
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Annotate this page' },
    commands: {
      // Fires action.onClicked, so the shortcut and the icon share one handler. Chrome assigns
      // no suggested key that is one of its own shortcuts (Alt+Shift+A, Ctrl+K), silently.
      _execute_action: { suggested_key: { default: 'Ctrl+Shift+K' } },
    },
  },
})
