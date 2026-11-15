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
import {
  audioBytes,
  clearArchive,
  countArchive,
  exportArchive,
  exportName,
} from '@/lib/voice/archive'
import { zip } from '@/lib/zip'

// Settings → Archive (spec section 8): the text and the recording of every dictation, kept in
// this browser. The panel reads the archive itself (the same origin's IndexedDB); Export hands
// it to the developer as a ZIP file, the only way it leaves.

/** How many dictations it holds; null until it is read, or when it cannot be. */
const count = ref<number | null>(null)
/** The bytes of its recordings. */
const bytes = ref(0)
const error = ref('')
const confirming = ref(false)
const exporting = ref(false)

async function read() {
  count.value = await countArchive().catch(() => null)
  bytes.value = await audioBytes().catch(() => 0)
}
onMounted(read)

const size = (n: number) =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(1)} GB`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)} MB`
      : `${Math.ceil(n / 1000)} kB`

/** A file through a link the browser downloads: no permission, nothing leaves otherwise. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** One ZIP file, or several when the recordings do not fit one. */
async function download() {
  error.value = ''
  exporting.value = true
  const now = new Date()
  try {
    await exportArchive((entries, volume) => save(zip(entries, now), exportName(now, volume)), now)
  } catch {
    error.value = 'Could not export the archive.'
  }
  exporting.value = false
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
      The text and the recording of every dictation are kept in this browser, also after its note or
      pin is deleted: when it was made, where it went, and the transcript before its correction.
      Export saves all of it as a ZIP file.
    </p>
    <div class="flex items-center gap-2">
      <span data-testid="archive-count" class="min-w-0 flex-1 text-xs">
        {{ count === null ? 'Could not read the archive.' : plural(count, 'dictation') }}
        <span v-if="bytes" data-testid="archive-size" class="text-muted-foreground">
          · {{ size(bytes) }} of recordings
        </span>
      </span>
      <Button
        data-testid="archive-export"
        variant="outline"
        size="sm"
        :disabled="!count || exporting"
        title="Save all of them as a ZIP file: dictations.json and the recordings"
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
            This removes the kept text and recordings of {{ plural(count ?? 0, 'dictation') }} for
            good. Export them first if you want to keep them. Notes and pins stay as they are.
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
