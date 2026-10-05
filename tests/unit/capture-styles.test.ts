import { describe, expect, it } from 'vitest'
import { pickStyles } from '@/lib/capture/styles'
import { CURATED_STYLES } from '@/lib/collection/model'

const declaration = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? '',
})

const block = {
  display: 'block',
  position: 'static',
  width: '320px',
  height: '48px',
  margin: '0px',
  padding: '0px 24px',
  gap: '8px',
  'flex-direction': 'row',
  'justify-content': 'normal',
  'align-items': 'normal',
  'grid-template-columns': 'none',
  'font-family': 'Inter, sans-serif',
  'font-size': '16px',
  'font-weight': '400',
  'line-height': '24px',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  border: '0px none rgb(0, 0, 0)',
  'border-radius': '0px',
  cursor: 'pointer',
}

describe('pickStyles', () => {
  it('drops defaults and container properties on a block', () => {
    expect(pickStyles(declaration(block))).toEqual({
      display: 'block',
      width: '320px',
      height: '48px',
      padding: '0px 24px',
      'font-family': 'Inter, sans-serif',
      'font-size': '16px',
      'font-weight': '400',
      'line-height': '24px',
      color: 'rgb(0, 0, 0)',
    })
  })

  it('keeps flex properties on a flex container, in curated order', () => {
    const styles = pickStyles(
      declaration({
        ...block,
        display: 'inline-flex',
        position: 'relative',
        'align-items': 'center',
        'background-color': 'rgb(255, 255, 255)',
        border: '1px solid rgb(229, 231, 235)',
        'border-radius': '6px',
      }),
    )
    expect(styles).toMatchObject({
      display: 'inline-flex',
      position: 'relative',
      gap: '8px',
      'flex-direction': 'row',
      'align-items': 'center',
      'background-color': 'rgb(255, 255, 255)',
      border: '1px solid rgb(229, 231, 235)',
      'border-radius': '6px',
    })
    expect(styles).not.toHaveProperty('justify-content')
    expect(styles).not.toHaveProperty('grid-template-columns')
    const order = CURATED_STYLES.filter((name) => name in styles)
    expect(Object.keys(styles)).toEqual(order)
  })

  it('keeps grid columns on a grid container only', () => {
    const grid = pickStyles(
      declaration({ ...block, display: 'grid', 'grid-template-columns': '1fr 1fr' }),
    )
    expect(grid['grid-template-columns']).toBe('1fr 1fr')
    expect(grid).not.toHaveProperty('flex-direction')
  })

  it('caps long values at 80 code points', () => {
    const styles = pickStyles(declaration({ ...block, 'font-family': 'x'.repeat(200) }))
    expect(styles['font-family']).toHaveLength(80)
    expect(styles['font-family']?.endsWith('…')).toBe(true)
  })

  it('never returns properties outside the curated list', () => {
    expect(Object.keys(pickStyles(declaration(block)))).not.toContain('cursor')
  })
})
