<template>
  <div class="flex items-center gap-2 p-2 bg-shade-8 border rounded-sm">
    <Button variant="ghost" size="icon" :disabled="location == null" @click="center">
      <LocateFixed class="size-5" />
    </Button>
    <Toggle
      v-for="layer of layers"
      variant="ghost"
      size="icon"
      v-model="settings[layer.key]"
      :title="layer.title"
    >
      <div class="size-4 rounded-full" :style="{ background: layer.color }" />
    </Toggle>
  </div>
</template>

<script setup>
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useLocation } from '@/composables/useLocation';
import { layers } from '@/modules/layers';
import { useSettingsStore } from '@/stores/settings';
import { LocateFixed } from 'lucide-vue-next';
import { Map } from 'mapbox-gl';
import { storeToRefs } from 'pinia';

const props = defineProps({
  map: { type: Map, required: true },
});

const { settings } = storeToRefs(useSettingsStore());
const { location } = useLocation();

const center = () => {
  props.map.flyTo({
    center: [location.value.lng, location.value.lat],
    zoom: 15,
  });
};
</script>

<style scoped>
.circle {
  @apply size-4;
  @apply rounded-full;
}
</style>
