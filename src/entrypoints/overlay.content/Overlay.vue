<!-- Placeholder until milestone 2: proves styling, layering and portals in the shadow root. -->
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

defineProps<{ portalTarget: HTMLElement }>()
</script>

<template>
  <!-- Max z-index on every positioned layer: pages use it too, and the host is appended last,
       so equal z-index puts the overlay on top. The portaled content needs its own. -->
  <div class="fixed right-4 bottom-4 z-[2147483647] font-sans">
    <Popover>
      <PopoverTrigger as-child>
        <Button data-testid="overlay-trigger" size="sm" class="shadow-lg">Webdev overlay</Button>
      </PopoverTrigger>
      <PopoverContent
        :to="portalTarget"
        data-testid="overlay-popover"
        class="z-[2147483647] w-64 text-sm"
      >
        Marking tools arrive in the next version.
      </PopoverContent>
    </Popover>
  </div>
</template>
