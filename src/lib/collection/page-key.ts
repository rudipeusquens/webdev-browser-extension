/**
 * Key of a page in the collection: the URL without its hash and without a user name or
 * password; query and trailing slash stay. Credentials and hash tokens never reach storage or
 * the prompt.
 */
export function pageKey(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  return parsed.href
}
