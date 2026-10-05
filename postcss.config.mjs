// rem → px: the overlay lives inside arbitrary pages, whose root font size must not scale it.
import remToPx from 'postcss-rem-to-responsive-pixel'

export default {
  plugins: [remToPx({ rootValue: 16, propList: ['*'], transformUnit: 'px' })],
}
