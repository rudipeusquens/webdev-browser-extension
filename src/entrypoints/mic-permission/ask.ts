// Chrome grants the microphone per origin, and only a page in a tab can show its prompt: the
// side panel and the offscreen recorder cannot (spec section 5). This page asks once for the
// extension's origin; the recorder can then use the microphone.

export type MicAnswer = 'allowed' | 'blocked' | 'missing' | 'failed'

export async function askMicrophone(
  media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
): Promise<MicAnswer> {
  try {
    const stream = await media.getUserMedia({ audio: true })
    // Only the permission is wanted here, not a recording.
    for (const track of stream.getTracks()) track.stop()
    return 'allowed'
  } catch (error) {
    const name = error instanceof Error || error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing'
    return 'failed'
  }
}
