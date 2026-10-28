<template>
  <div
    class="bg-shade-8 flex max-w-[calc(100vw-20px)] flex-wrap items-center gap-2 rounded-sm border p-2"
  >
    <Button variant="ghost" size="icon" title="Locate" :disabled="location == null" @click="locate">
      <PhGpsFix class="size-4" />
    </Button>

    <Button variant="ghost" size="icon" title="Upload route" @click="uploadRoute">
      <PhPath class="size-4" />
    </Button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" title="Settings">
          <PhGear class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            v-for="country in Country.$values"
            v-model="settings[country]"
            @select.prevent
          >
            {{ Country.$translate(country) }}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <Toggle
      v-for="[poi, { name, color }] in Object.entries(pois)"
      variant="ghost"
      size="icon"
      :title="name"
      v-model="settings[poi]"
    >
      <div class="size-4 rounded-full" :style="{ background: color }" />
    </Toggle>
  </div>
</template>

<script setup>
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toggle } from '@/components/ui/toggle';
import { useLocation } from '@/composables/useLocation';
import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { useSettingsStore } from '@/stores/settings';
import { colors } from '@/utils/colors';
import { readAsText, selectFile } from '@/utils/filesystem';
import { gpxToGeoJson } from '@/utils/geoJson';
import { cn } from '@/utils/ui';
import { PhGear, PhGpsFix, PhPath } from '@phosphor-icons/vue';
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

  if (props.map.getLayer(id)) {
    props.map.removeLayer(id);
  }
  if (props.map.getSource(id)) {
    props.map.removeSource(id);
  }

  route = null;

  const content = await readAsText(await selectFile('gpx'));
  const geojson = gpxToGeoJson(content);

  const coordinates = [];
  turf.featureEach(geojson, (feature) => {
    if (feature.geometry?.type === 'LineString') {
      coordinates.push(...feature.geometry.coordinates);
    }
  });
  if (coordinates.length === 0) {
    route = null;
    return;
  }

  route = turf.lineString(coordinates);

  props.map.addLayer(
    {
      id,
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
        'line-width': {
          stops: [
            [6, 0.5],
            [18, 8],
          ],
        },
      },
    },
    `${id}-order`,
  );

  const w = window.innerWidth;
  const h = window.innerHeight;
  props.map.fitBounds(turf.bbox(geojson), { padding: 0.1 * Math.min(w, h) });
};

let marker = null;
let markerEvent = null;

const { ctrl } = useMagicKeys();

const updateDistanceMarker = (event) => {
  if (event == null) {
    return;
  }

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
    element.className = cn('bg-shade-2 text-shade-8 rounded-sm p-1 text-xs');

    marker = new Marker({ element, closeOnClick: false, anchor: 'center' })
      .setLngLat(closestPoint.geometry.coordinates)
      .addTo(props.map);
  }

  marker.setLngLat(closestPoint.geometry.coordinates);
  marker.getElement().textContent = closestPoint.properties.totalDistance.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
      useGrouping: false,
    },
  );
};

watch(ctrl, () => {
  updateDistanceMarker(markerEvent);
});

props.map.on('mousemove', updateDistanceMarker);
</script>
