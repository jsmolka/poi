<template>
  <div class="flex items-center gap-2 p-2 bg-shade-8 border rounded-sm">
    <Button variant="ghost" size="icon" :disabled="location == null" title="Locate" @click="locate">
      <LocateFixed class="size-5" />
    </Button>
    <Button variant="ghost" size="icon" title="Upload GPX" @click="uploadRoute">
      <RouteIcon class="size-5" />
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
import { colors } from '@/utils/colors';
import { readAsText, selectFile } from '@/utils/filesystem';
import toGeoJSON from '@mapbox/togeojson';
import { LocateFixed, RouteIcon } from 'lucide-vue-next';
import { Map } from 'mapbox-gl';
import { storeToRefs } from 'pinia';

const props = defineProps({
  map: { type: Map, required: true },
});

const { settings } = storeToRefs(useSettingsStore());
const { location } = useLocation();

const locate = () => {
  props.map.flyTo({
    center: [location.value.lng, location.value.lat],
    zoom: 15,
  });
};

const uploadRoute = async () => {
  const id = 'route';
  const map = props.map;
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);

  const content = await readAsText(await selectFile('gpx'));
  const geojson = toGeoJSON.gpx(new DOMParser().parseFromString(content, 'text/xml'));
  map.addSource(id, {
    type: 'geojson',
    data: geojson,
  });
  map.addLayer({
    id,
    type: 'line',
    source: 'route',
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': colors.shade2.hex,
      'line-width': 4,
    },
  });
};
</script>

<style scoped>
.circle {
  @apply size-4;
  @apply rounded-full;
}
</style>
