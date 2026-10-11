import { fakeBrowser } from 'wxt/testing/fake-browser'
import { fakeContextMenus } from './fake-context-menus'
import { fakePorts } from './fake-ports'
import { fakeSites } from './fake-sites'

/**
 * The browser APIs the background needs, faked: host permissions (`granted`), the context menu
 * (`later`: its entries appear asynchronously) and ports with the offscreen document. Call it
 * before `background.main()`.
 */
export function fakeChrome({
  granted = [],
  later = false,
}: { granted?: string[]; later?: boolean } = {}) {
  const sites = fakeSites(granted)
  const menus = fakeContextMenus({ later })
  const ports = fakePorts()
  return { sites, menus, ports }
}

/** Delivers `message` to the background's onMessage listeners; resolves with the reply. */
export async function send(message: unknown, sender: object): Promise<unknown> {
  let reply: unknown
  const responded = new Promise<void>((done) => {
    void fakeBrowser.runtime.onMessage
      .trigger(message, sender, (value: unknown) => {
        reply = value
        done()
      })
      .then((results: unknown[]) => {
        if (!results.includes(true)) done()
      })
  })
  await responded
  return reply
}

/** A value in `storage.local`. */
export const stored = async (key: string) => (await fakeBrowser.storage.local.get(key))[key]
