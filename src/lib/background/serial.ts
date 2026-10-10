// Tasks that must not overlap (a read, change and write of the same storage; the single
// offscreen document) run one after another: messages and events arrive at once from every tab
// and the panel.

/**
 * A queue of its own: each task starts once the one before has settled. A task that fails
 * does not hold up the next one; the promise of that task rejects.
 */
export function serial() {
  let queue: Promise<unknown> = Promise.resolve()
  return function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }
}
