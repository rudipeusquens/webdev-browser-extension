// What the panel's voice settings show (spec section 8): model and language, the key only
// masked, and the extension's microphone permission. The background writes all of it.

import { onBeforeUnmount, onMounted, type Ref, ref, shallowRef } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { isKeyChanged } from '@/lib/messages'
import { loadKey, maskKey } from '@/lib/voice/key'
import {
  defaultVoiceSettings,
  loadVoiceSettings,
  type VoiceSettings,
  watchVoiceSettings,
} from '@/lib/voice/settings'

export type Microphone = PermissionState | 'unknown'

export function useVoiceSettings(): {
  voice: Ref<VoiceSettings>
  /** The stored key as the settings show it; null when there is none. */
  maskedKey: Ref<string | null>
  microphone: Ref<Microphone>
} {
  const voice = shallowRef<VoiceSettings>(defaultVoiceSettings())
  const maskedKey = ref<string | null>(null)
  const microphone = ref<Microphone>('unknown')
  let changed = false
  let stop: (() => void) | undefined
  let permission: PermissionStatus | undefined

  // Only the masked form leaves this function.
  const readKey = async () => {
    const key = await loadKey().catch(() => undefined)
    maskedKey.value = key ? maskKey(key) : null
  }
  // The background announces every change of the key to open panels.
  const onKey = (message: unknown, sender: Browser.runtime.MessageSender) => {
    if (sender.id === browser.runtime.id && isKeyChanged(message)) void readKey()
  }

  onMounted(async () => {
    stop = watchVoiceSettings((next) => {
      changed = true
      voice.value = next
    })
    browser.runtime.onMessage.addListener(onKey)
    void readKey()
    const loaded = await loadVoiceSettings()
    // A change that arrived while loading is newer than what was loaded.
    if (!changed) voice.value = loaded
    try {
      permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      microphone.value = permission.state
      permission.onchange = () => {
        if (permission) microphone.value = permission.state
      }
    } catch {
      microphone.value = 'unknown'
    }
  })

  onBeforeUnmount(() => {
    stop?.()
    browser.runtime.onMessage.removeListener(onKey)
    if (permission) permission.onchange = null
  })

  return { voice, maskedKey, microphone }
}
