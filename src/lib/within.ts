// A deadline for an answer from another context (the background, a page, an overlay), for the
// overlay and the background alike: no DOM, no browser APIs.

/** `promise`'s value, or `late` (undefined unless given) when it takes longer than `ms`. */
export function within<T, L = undefined>(
  promise: Promise<T>,
  ms: number,
  late?: L,
): Promise<T | L> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<L>((done) => {
    timer = setTimeout(() => done(late as L), Math.max(0, ms))
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
