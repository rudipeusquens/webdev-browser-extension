<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { siteLabel } from '@/lib/collection/site'

/** The site to forget; the dialog is open while there is one. */
const props = defineProps<{ origin: string | null }>()
const emit = defineEmits<{ confirm: [origin: string]; close: [] }>()

const open = computed({
  get: () => props.origin !== null,
  set: (value) => {
    if (!value) emit('close')
  },
})
const name = computed(() => (props.origin ? siteLabel(props.origin) : ''))

function confirm() {
  if (props.origin) emit('confirm', props.origin)
  emit('close')
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent data-testid="forget-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>Forget {{ name }}?</AlertDialogTitle>
        <AlertDialogDescription>
          Its pages stop loading the overlay by themselves, and Chrome takes back the extension's
          access to the site. Its feedback stays.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="forget-cancel">Cancel</AlertDialogCancel>
        <AlertDialogAction
          data-testid="forget-confirm"
          :class="buttonVariants({ variant: 'destructive' })"
          @click="confirm"
        >
          Forget site
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
