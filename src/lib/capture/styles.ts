// The curated computed styles of spec section 6, without values that only restate a default.

import { CURATED_STYLES, LIMITS } from '../collection/model'
import { clean } from '../text'

const FLEX = /^(?:inline-)?flex$/
const GRID = /^(?:inline-)?grid$/

function keep(name: string, value: string, display: string): boolean {
  const container = FLEX.test(display) || GRID.test(display)
  switch (name) {
    case 'position':
      return value !== 'static'
    case 'margin':
    case 'padding':
    case 'border-radius':
      return value !== '0px' && value !== '0'
    case 'background-color':
      return value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'
    case 'border':
      return !/^0px\b/.test(value) && !/\bnone\b/.test(value)
    case 'gap':
    case 'justify-content':
    case 'align-items':
      return container && value !== 'normal'
    case 'flex-direction':
      return FLEX.test(display)
    case 'grid-template-columns':
      return GRID.test(display) && value !== 'none'
    default:
      return true
  }
}

export function pickStyles(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): Record<string, string> {
  const display = style.getPropertyValue('display').trim()
  const picked: Record<string, string> = {}
  for (const name of CURATED_STYLES) {
    const value = style.getPropertyValue(name).trim()
    if (value && keep(name, value, display)) picked[name] = clean(value, LIMITS.styleValue)
  }
  return picked
}
