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

defineProps<{ items: number; pages: number }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [] }>()

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Clear all feedback?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes {{ plural(items, 'item') }} on {{ plural(pages, 'page') }}. Numbering starts
          again at 1. This can't be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="clear-cancel">Cancel</AlertDialogCancel>
        <AlertDialogAction
          data-testid="clear-confirm"
          :class="buttonVariants({ variant: 'destructive' })"
          @click="emit('confirm')"
        >
          Clear all
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
