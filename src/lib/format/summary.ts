// One short line per item for the side panel list.

import type { Target } from '../collection/model'
import { truncate } from '../text'

const tagName = (openingTag: string) => /^<([^\s>]+)/.exec(openingTag)?.[1] ?? 'element'

export function targetSummary(target: Target): string {
  switch (target.kind) {
    case 'element': {
      const { element } = target
      const component = element.origin?.chain.at(-1)?.name
      const text = element.text ? ` "${truncate(element.text, 40)}"` : ''
      return `${component ? `${component} · ` : ''}${tagName(element.openingTag)}${text}`
    }
    case 'text':
      return `"${truncate(target.selected, 60)}"`
    case 'area': {
      const count = target.elements.length + target.moreCount
      return `Area with ${count} element${count === 1 ? '' : 's'}`
    }
  }
}
