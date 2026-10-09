// The panel's voice settings and the API key (spec sections 8 and 9). Only the panel may
// change them: the background checks the sender's URL, not just that it has no tab.

import { browser } from 'wxt/browser'
import type { KeyChanged, KeyTestReply, Reply, VoiceSettingsMessage } from '../messages'
import { deleteKey, loadKey, storeKey } from '../voice/key'
import { checkKey, VoiceFailure } from '../voice/openrouter'
import { VOICE_KEY } from '../voice/settings'

/** A message from the extension's side panel. */
export { isPanelSender } from './senders'

export async function testKey(check = checkKey): Promise<KeyTestReply> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Add an OpenRouter API key first.' }
  try {
    return { ok: true, valid: await check(key) }
  } catch (error) {
    const unreachable =
      error instanceof VoiceFailure && (error.code === 'offline' || error.code === 'timeout')
    return {
      ok: false,
      error: unreachable ? 'Could not reach OpenRouter.' : 'OpenRouter could not check the key.',
    }
  }
}

/** Open panels show the key masked: they hear that it changed, never what it is. */
function announceKey() {
  browser.runtime
    .sendMessage({ type: 'voice:key:changed' } satisfies KeyChanged)
    .catch(() => undefined)
}

export async function setVoice(message: VoiceSettingsMessage): Promise<Reply | KeyTestReply> {
  switch (message.type) {
    case 'voice:set':
      await browser.storage.local.set({
        [VOICE_KEY]: { model: message.model, language: message.language, limit: message.limit },
      })
      return { ok: true }
    case 'voice:key:save':
      await storeKey(message.key)
      announceKey()
      return { ok: true }
    case 'voice:key:remove':
      await deleteKey()
      announceKey()
      return { ok: true }
    case 'voice:key:test':
      return testKey()
  }
}
