// One short line per item for the side panel list.

import type { Target } from '../collection/model'
import { plural, truncate } from '../text'

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
    case 'area':
      return `Area with ${plural(target.elements.length + target.moreCount, 'element')}`
  }
}
