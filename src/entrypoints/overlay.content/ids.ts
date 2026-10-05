/**
 * A new annotation id. `crypto.randomUUID()` exists only in secure contexts, and content
 * scripts on plain-HTTP hosts other than localhost are not one.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
