<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="card">{{ title }}</div>
</template>

<style>
.card {
  width: 120px;
  padding: 12px;
  border: 1px solid #ccc;
}
</style>
