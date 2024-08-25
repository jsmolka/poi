<template>
  <div class="flex flex-col gap-1.5 px-2 py-1.5 bg-shade-5 text-xs rounded-sm">
    <div v-for="layer in layers" class="flex items-center gap-2">
      <div class="size-2 rounded-full" :style="{ background: layer.color }" />
      <div>{{ layer.title }}</div>
    </div>
  </div>
</template>

<script setup>
import { layers } from '@/modules/layers';
</script>
