<script setup lang="ts">
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

/** `pins` and `pages`: the deleted pins and their pages; `site`: such as `localhost:3000`. */
defineProps<{ pins: number; pages: number; site: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [] }>()

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Empty the bin?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes {{ plural(pins, 'deleted pin') }} on {{ plural(pages, 'page') }} of
          {{ site }} for good. Numbering starts again at 1 once nothing is left. Undo can bring them
          back until the browser closes.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="empty-bin-cancel">Cancel</AlertDialogCancel>
        <AlertDialogAction
          data-testid="empty-bin-confirm"
          :class="buttonVariants({ variant: 'destructive' })"
          @click="emit('confirm')"
        >
          Empty bin
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
