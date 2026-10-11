// The panel's voice settings and the API key (spec sections 8 and 9). Only the panel may
// change them: the background checks the sender's URL, not just that it has no tab.

import { browser } from 'wxt/browser'
import type { KeyChanged, KeyTestReply, Reply, VoiceSettingsMessage } from '../messages'
import { deleteKey, loadKey, storeKey } from '../voice/key'
import { checkKey, VoiceFailure } from '../voice/openrouter'
import { loadVoiceSettings, VOICE_KEY } from '../voice/settings'
import { serial } from './serial'

/** One change of the settings at a time: each merges into what the one before wrote. */
const inOrder = serial()

async function testKey(): Promise<KeyTestReply> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Add an OpenRouter API key first.' }
  try {
    return { ok: true, valid: await checkKey(key) }
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
      // Only the fields that changed; the others stay as stored.
      return inOrder(async () => {
        const stored = await loadVoiceSettings()
        const { model = stored.model, language = stored.language, limit = stored.limit } = message
        await browser.storage.local.set({ [VOICE_KEY]: { model, language, limit } })
        return { ok: true }
      })
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
