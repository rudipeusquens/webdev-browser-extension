<script setup lang="ts">
import { DownloadIcon, Trash2Icon } from '@lucide/vue'
import { onMounted, ref } from 'vue'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { plural } from '@/lib/text'
import { clearArchive, countArchive, exportName, exportOf, loadArchive } from '@/lib/voice/archive'

// Settings → Archive (spec section 8): the text of every dictation, kept in this browser. The
// panel reads the archive itself (the same origin's IndexedDB); Export hands it to the
// developer as a file, the only way it leaves.

/** How many dictations it holds; null until it is read, or when it cannot be. */
const count = ref<number | null>(null)
const error = ref('')
const confirming = ref(false)

async function read() {
  count.value = await countArchive().catch(() => null)
}
onMounted(read)

/** A JSON file through a link the browser downloads: no permission, nothing leaves otherwise. */
async function download() {
  error.value = ''
  try {
    const text = JSON.stringify(exportOf(await loadArchive()), null, 2)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportName()
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    error.value = 'Could not export the archive.'
  }
  await read()
}

async function clear() {
  error.value = ''
  await clearArchive().catch(() => (error.value = 'Could not delete the archive.'))
  await read()
}
</script>

<template>
  <section data-testid="archive-settings" class="space-y-2">
    <h3 class="text-xs font-medium text-muted-foreground">Archive</h3>
    <p class="text-xs text-muted-foreground">
      The text of every dictation is kept in this browser, also after its note or pin is deleted:
      when it was made, where it went, and the transcript before its correction. The recordings
      themselves are not kept.
    </p>
    <div class="flex items-center gap-2">
      <span data-testid="archive-count" class="min-w-0 flex-1 text-xs">
        {{ count === null ? 'Could not read the archive.' : plural(count, 'dictation') }}
      </span>
      <Button
        data-testid="archive-export"
        variant="outline"
        size="sm"
        :disabled="!count"
        title="Save all of them as a JSON file"
        @click="download"
      >
        <DownloadIcon /> Export
      </Button>
      <Button
        data-testid="archive-clear"
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground"
        :disabled="!count"
        aria-label="Delete the archive"
        title="Delete the archive"
        @click="confirming = true"
      >
        <Trash2Icon />
      </Button>
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    <AlertDialog v-model:open="confirming">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the archive?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the kept text of {{ plural(count ?? 0, 'dictation') }} for good. Export it
            first if you want to keep it. Notes and pins stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="archive-clear-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="archive-clear-confirm"
            :class="buttonVariants({ variant: 'destructive' })"
            @click="clear"
          >
            Delete archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
