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
import { gpxToGeoJson } from '@/utils/geoJson';
import { PhGpsFix, PhPath } from '@phosphor-icons/vue';
import * as turf from '@turf/turf';
import { useMagicKeys } from '@vueuse/core';
import { Map, Marker } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

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

let route = null;

const uploadRoute = async () => {
  const id = 'route';

  if (props.map.getLayer(id)) props.map.removeLayer(id);
  if (props.map.getSource(id)) props.map.removeSource(id);

  route = null;
  updateDistanceMarker();

  const content = await readAsText(await selectFile('gpx'));
  const geojson = gpxToGeoJson(content);

  const coordinates = [];
  turf.featureEach(geojson, (feature) => {
    if (feature.geometry?.type === 'LineString') {
      coordinates.push(...feature.geometry.coordinates);
    }
  });
  if (coordinates.length > 0) {
    route = turf.lineString(coordinates);
  } else {
    route = null;
  }

  props.map.addDataLayer({
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

  const w = window.innerWidth;
  const h = window.innerHeight;
  props.map.fitBounds(turf.bbox(geojson), { padding: 0.1 * Math.min(w, h) });
};

let marker = null;
let markerEvent = null;

const { ctrl } = useMagicKeys();

const updateDistanceMarker = (event) => {
  markerEvent = event;
  if (route == null || !ctrl.value) {
    marker?.remove();
    marker = null;
    return;
  }

  const cursor = turf.point([event.lngLat.lng, event.lngLat.lat]);
  const closestPoint = turf.nearestPointOnLine(route, cursor, { units: 'kilometers' });

  if (marker == null) {
    const element = document.createElement('div');
    element.className = 'bg-shade-2 text-shade-8 text-xs p-1 rounded-sm';

    marker = new Marker({ element, closeOnClick: false, anchor: 'center' })
      .setLngLat(closestPoint.geometry.coordinates)
      .addTo(props.map);
  }
  marker.setLngLat(closestPoint.geometry.coordinates);
  marker.getElement().textContent = closestPoint.properties.location.toFixed(1);
};

props.map.on('mousemove', updateDistanceMarker);

watch(ctrl, () => updateDistanceMarker(markerEvent));
</script>
