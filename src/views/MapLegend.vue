<template>
  <div class="bg-shade-5 flex flex-col gap-1.5 rounded-sm px-2 py-1.5 text-xs">
    <div v-for="{ name, color } in Object.values(pois)" class="flex items-center gap-2">
      <div class="size-2 rounded-full" :style="{ background: color }" />
      {{ name }}
    </div>
  </div>
</template>

<script setup>
import { pois } from '@/modules/pois';
</script>
