import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { request } from '@/lib/request'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request', () => {
  const message = { type: 'settings:set', key: 'pageTitles', value: true } as const

  it("gives the background's reply", async () => {
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValue({ ok: false, error: 'No.' } as never)
    expect(await request(message)).toEqual({ ok: false, error: 'No.' })
    expect(send).toHaveBeenCalledWith(message)
  })

  it('gives undefined when the message fails, also when sending throws at once', async () => {
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
    send.mockRejectedValueOnce(new Error('Could not establish connection.'))
    expect(await request(message)).toBeUndefined()
    send.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated.')
    })
    expect(await request(message)).toBeUndefined()
  })
})
