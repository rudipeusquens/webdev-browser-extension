<script setup lang="ts">
import { Button } from '@/components/ui/button'
</script>

<template>
  <main class="flex h-screen flex-col text-sm">
    <header class="border-b px-4 py-3">
      <h1 class="font-semibold">Feedback</h1>
    </header>
    <section class="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
      <p>No feedback yet: pick an element, drag an area, or select text.</p>
    </section>
    <footer class="border-t p-3">
      <Button data-testid="copy-prompt" class="w-full" disabled>Copy as prompt</Button>
    </footer>
  </main>
</template>
