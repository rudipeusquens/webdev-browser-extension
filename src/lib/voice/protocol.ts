// Dictation (spec section 9): what can go wrong, and how the popover says it.

export type VoiceError =
  | 'no-key'
  | 'mic-not-granted'
  | 'mic-blocked'
  | 'no-mic'
  | 'mic-failed'
  | 'invalid-key'
  | 'no-credits'
  | 'rate-limited'
  | 'rejected'
  | 'failed'
  | 'timeout'
  | 'offline'
  | 'no-speech'
  | 'interrupted'
  | 'taken'

const TEXTS: Record<VoiceError, string> = {
  'no-key': 'Add an OpenRouter API key in settings.',
  'mic-not-granted': 'Allow the microphone first.',
  'mic-blocked': 'The microphone is blocked for this extension.',
  'no-mic': 'No microphone found.',
  'mic-failed': 'The microphone could not start.',
  'invalid-key': 'Invalid API key.',
  'no-credits': 'Out of credits.',
  'rate-limited': 'Rate limited, try again.',
  rejected: 'Transcription failed.',
  failed: 'Transcription failed.',
  timeout: 'Transcription timed out.',
  offline: 'Could not reach OpenRouter.',
  'no-speech': 'No speech detected.',
  interrupted: 'Recording stopped unexpectedly.',
  taken: 'Recording stopped: another one started.',
}

export const VOICE_ERRORS = Object.keys(TEXTS) as VoiceError[]

/** The popover's message; `detail` is OpenRouter's reason for a refused request. */
export function voiceErrorText(error: VoiceError, detail?: string): string {
  return error === 'rejected' && detail ? `Transcription failed: ${detail}` : TEXTS[error]
}
