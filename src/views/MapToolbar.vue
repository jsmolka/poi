<template>
  <div class="flex items-center gap-2 p-2 bg-shade-8 border rounded-sm">
    <Button variant="ghost" size="icon" title="Locate" :disabled="location == null" @click="locate">
      <PhGpsFix class="size-4" />
    </Button>
    <Button variant="ghost" size="icon" title="Upload route" @click="uploadRoute">
      <PhPath class="size-4" />
    </Button>
    <Toggle
      v-for="[key, layer] in Object.entries(layers)"
      variant="ghost"
      size="icon"
      v-model="settings[key]"
      :title="layer.text"
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
import { PhGpsFix, PhPath } from '@phosphor-icons/vue';
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

  map.addLayer({
    id: 'route',
    type: 'line',
    source: {
      type: 'geojson',
      data: geojson,
    },
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
