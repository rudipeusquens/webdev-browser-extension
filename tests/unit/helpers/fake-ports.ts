import { vi } from 'vitest'
import type { Browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'

type Listener<T extends unknown[]> = (...args: T) => void

function event<T extends unknown[]>() {
  const listeners = new Set<Listener<T>>()
  return {
    addListener: (fn: Listener<T>) => void listeners.add(fn),
    removeListener: (fn: Listener<T>) => void listeners.delete(fn),
    hasListener: (fn: Listener<T>) => listeners.has(fn),
    fire: (...args: T) => {
      for (const fn of [...listeners]) fn(...args)
    },
  }
}

/** One end of a port as the background sees it, with handles for the other end. */
export interface FakePort {
  name: string
  sender: Browser.runtime.MessageSender
  /** What the background posted, as the other end received it. */
  posted: unknown[]
  /** The background disconnected it. */
  disconnected: boolean
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: ReturnType<typeof event<[unknown, FakePort]>>
  onDisconnect: ReturnType<typeof event<[FakePort]>>
  /** The other end sends `message`. */
  receive(message: unknown): void
  /** The other end goes away (popover closed, document closed, tab gone). */
  close(): void
}

export function fakePort(name: string, sender: Browser.runtime.MessageSender): FakePort {
  let closed = false
  const port: FakePort = {
    name,
    sender,
    posted: [],
    disconnected: false,
    postMessage(message) {
      if (closed || port.disconnected) {
        throw new Error('Attempting to use a disconnected port object')
      }
      // Ports carry JSON-serializable copies.
      port.posted.push(JSON.parse(JSON.stringify(message)))
    },
    // Disconnecting does not fire the port's own onDisconnect, as in Chrome.
    disconnect() {
      port.disconnected = true
    },
    onMessage: event<[unknown, FakePort]>(),
    onDisconnect: event<[FakePort]>(),
    receive(message) {
      if (!closed && !port.disconnected) port.onMessage.fire(message, port)
    },
    close() {
      if (closed || port.disconnected) return
      closed = true
      port.onDisconnect.fire(port)
    },
  }
  return port
}

/** A tab's top frame, as the sender of an overlay's port. */
export const overlaySender = (tabId = 5, frameId = 0): Browser.runtime.MessageSender => ({
  id: fakeBrowser.runtime.id,
  tab: { id: tabId, windowId: 1, index: 2 } as Browser.tabs.Tab,
  frameId,
})

export const recorderSender = (path = '/offscreen.html'): Browser.runtime.MessageSender => ({
  id: fakeBrowser.runtime.id,
  url: fakeBrowser.runtime.getURL(path as '/offscreen.html'),
})

/**
 * `runtime.onConnect`, `offscreen.*` and `runtime.getContexts` as Chrome has them (WXT's fake
 * browser implements none): a created offscreen document connects its recorder port a task
 * later, unless `connects` is off; closing it closes that port.
 */
export function fakePorts() {
  const connect = event<[FakePort]>()
  const state = {
    exists: false,
    connects: true,
    created: [] as Browser.offscreen.CreateParameters[],
    closed: 0,
    /** The recorder port of the current document. */
    recorder: undefined as FakePort | undefined,
    /** Delivers `port` to the background's onConnect listeners. */
    connect: (port: FakePort) => connect.fire(port),
  }
  vi.spyOn(fakeBrowser.runtime.onConnect, 'addListener').mockImplementation(
    connect.addListener as never,
  )
  vi.spyOn(fakeBrowser.offscreen, 'createDocument').mockImplementation((async (
    parameters: Browser.offscreen.CreateParameters,
  ) => {
    if (state.exists) throw new Error('Only a single offscreen document may be created.')
    state.exists = true
    state.created.push(parameters)
    if (!state.connects) return
    setTimeout(() => {
      const port = fakePort('recorder', recorderSender())
      state.recorder = port
      state.connect(port)
    })
  }) as never)
  vi.spyOn(fakeBrowser.offscreen, 'closeDocument').mockImplementation((async () => {
    if (!state.exists) throw new Error('No current offscreen document.')
    state.exists = false
    state.closed++
    state.recorder?.close()
  }) as never)
  vi.spyOn(fakeBrowser.runtime, 'getContexts').mockImplementation((async () =>
    state.exists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []) as never)
  return state
}
