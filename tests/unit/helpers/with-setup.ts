import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

/** Runs `composable` in the setup of a throwaway component; `wrapper` unmounts it. */
export function withSetup<T>(composable: () => T) {
  let result!: T
  const wrapper = mount(
    defineComponent({
      setup() {
        result = composable()
        return () => null
      },
    }),
  )
  return { result, wrapper }
}
