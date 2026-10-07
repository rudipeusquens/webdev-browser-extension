<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { Button } from '@/components/ui/button'
import { siteLabel, siteOf } from '@/lib/collection/site'
import { isSiteOrigin } from '@/lib/settings'
import type { TabStatus } from './use-active-tab'

// The site of the active tab in the middle of the title row: a dot for its state (green
// active, grey not active, red refused or failed) and its name. Hovering or focusing it shows
// its one action, if it has one (spec section 8).

const props = defineProps<{ status: TabStatus; remembered: boolean }>()
const emit = defineEmits<{ start: []; remember: []; forget: [] }>()

/** How long the pointer rests before the action shows, and may wander off before it goes. */
const SHOW_AFTER = 150
const HIDE_AFTER = 200

/** The tab's site, where the overlay or Chrome tells it. */
const site = computed(() => {
  const s = props.status
  const url = s.kind === 'active' ? s.pageKey : s.url
  if (!url) return null
  try {
    return siteOf(url)
  } catch {
    return null
  }
})

const label = computed(() => {
  if (site.value) return siteLabel(site.value)
  if (props.status.kind === 'blocked') return "Can't run here"
  if (props.status.kind === 'failed') return "Couldn't start"
  return 'Not active'
})

const STATE_TEXT: Record<TabStatus['kind'], string> = {
  active: 'Active on this tab',
  idle: 'Not active on this tab',
  blocked: "Chrome doesn't let extensions run on this page",
  failed: "Couldn't start on this page",
}

const tooltip = computed(() => {
  const state = STATE_TEXT[props.status.kind]
  const auto = props.status.kind === 'active' && props.remembered ? ' · loads by itself' : ''
  return site.value ? `${site.value} · ${state}${auto}` : state
})

const DOT: Record<TabStatus['kind'], string> = {
  active: 'bg-green-500',
  idle: 'bg-muted-foreground/40',
  blocked: 'bg-red-500',
  failed: 'bg-red-500',
}

/** The one thing the pill offers: none on pages it cannot name or run on. */
const action = computed<'forget' | 'remember' | 'start' | null>(() => {
  const current = site.value
  if (!current) return null
  if (props.status.kind === 'active') {
    // Local files cannot be remembered: Chrome grants no origin for them.
    if (!isSiteOrigin(current)) return null
    return props.remembered ? 'forget' : 'remember'
  }
  return props.status.kind === 'idle' ? 'start' : null
})

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const pill = useTemplateRef<HTMLElement>('pill')
let timer: ReturnType<typeof setTimeout> | undefined
// The pill takes the focus back after Escape or an action: that must not open it again.
let refocusing = false

function later(next: boolean, ms: number) {
  clearTimeout(timer)
  timer = setTimeout(() => (open.value = next), ms)
}

/** Focus and clicks open it; a click never closes it (the click focuses the pill first). */
function onFocusIn() {
  if (refocusing || !action.value) return
  clearTimeout(timer)
  open.value = true
}

/** The pointer on the pill or its action; leaving both closes it after a moment. */
function onPointer(inside: boolean) {
  if (inside && action.value) later(true, open.value ? 0 : SHOW_AFTER)
  else if (!inside) later(false, HIDE_AFTER)
}

function onFocusOut(e: FocusEvent) {
  if (!root.value?.contains(e.relatedTarget as Node | null)) open.value = false
}

/** The focus goes back to the pill: the action it was on goes away. */
function refocus() {
  refocusing = true
  try {
    pill.value?.focus()
  } finally {
    refocusing = false
  }
}

/** Escape closes the action; an Escape that closes it does nothing else in the panel. */
function close(e: KeyboardEvent) {
  if (open.value) e.preventDefault()
  clearTimeout(timer)
  open.value = false
  refocus()
}

function act(name: 'forget' | 'remember' | 'start') {
  clearTimeout(timer)
  open.value = false
  // Synchronously, inside the click: Chrome asks for access only within it.
  if (name === 'forget') emit('forget')
  else if (name === 'remember') emit('remember')
  else emit('start')
  refocus()
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div
    ref="root"
    class="relative flex min-w-0 justify-center"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown.escape="close"
  >
    <component
      :is="action ? 'button' : 'span'"
      ref="pill"
      data-testid="site-pill"
      :data-state="status.kind"
      :type="action ? 'button' : undefined"
      :aria-expanded="action ? open : undefined"
      :aria-controls="action ? 'site-actions' : undefined"
      class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="action && 'hover:bg-accent hover:text-accent-foreground'"
      :title="tooltip"
      @click="onFocusIn"
      @pointerenter="onPointer(true)"
      @pointerleave="onPointer(false)"
    >
      <span data-testid="site-dot" class="size-2 shrink-0 rounded-full" :class="DOT[status.kind]" />
      <span data-testid="title-site" class="truncate">{{ label }}</span>
      <!-- The dot's meaning, for screen readers. -->
      <span class="sr-only">· {{ STATE_TEXT[status.kind] }}</span>
    </component>
    <div
      v-if="open && action"
      id="site-actions"
      class="absolute top-full left-1/2 z-30 mt-1 -translate-x-1/2 rounded-md border bg-popover p-1 whitespace-nowrap text-popover-foreground shadow-md"
      @pointerenter="onPointer(true)"
      @pointerleave="onPointer(false)"
    >
      <Button
        v-if="action === 'forget'"
        data-testid="forget-site"
        variant="ghost"
        size="xs"
        class="text-muted-foreground"
        :title="`Stop loading the overlay on ${site} by itself`"
        @click="act('forget')"
      >
        Forget this site
      </Button>
      <Button
        v-else-if="action === 'remember'"
        data-testid="remember-site"
        variant="outline"
        size="xs"
        :title="`Load the overlay on every page of ${site}`"
        @click="act('remember')"
      >
        Always enable here
      </Button>
      <Button
        v-else
        data-testid="start-overlay"
        variant="outline"
        size="xs"
        title="Start the overlay on this page"
        @click="act('start')"
      >
        Annotate this page
      </Button>
    </div>
  </div>
</template>
