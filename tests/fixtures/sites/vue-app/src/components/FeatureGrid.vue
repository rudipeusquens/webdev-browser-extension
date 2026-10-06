<script setup lang="ts">
import FeatureCard from './FeatureCard.vue'

const features = ['Fast setup', 'Secure', 'Support']
</script>

<template>
  <section class="features">
    <FeatureCard v-for="title in features" :key="title" :title="title" />
  </section>
</template>

<style>
.features {
  display: flex;
  gap: 16px;
  padding: 32px;
}
</style>
