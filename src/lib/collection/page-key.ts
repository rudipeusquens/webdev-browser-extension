/** Key of a page in the collection: the URL without its hash; query and trailing slash stay. */
export function pageKey(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}
