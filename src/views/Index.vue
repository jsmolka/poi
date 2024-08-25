<template>
  <div id="map" class="h-full bg-shade-6" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import { useLocation } from '@/composables/useLocation';
import { layers } from '@/modules/layers';
import { useSettingsStore } from '@/stores/settings';
import Legend from '@/views/Legend.vue';
import LocationMarker from '@/views/LocationMarker.vue';
import Toolbar from '@/views/Toolbar.vue';
import { watchOnce } from '@vueuse/core';
import { Map, Marker, Popup, ScaleControl } from 'mapbox-gl';
import { storeToRefs } from 'pinia';
import { createApp, onMounted, watch } from 'vue';

const { settings } = storeToRefs(useSettingsStore());
const { location } = useLocation();

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

let map = null;

const mount = (component, props = {}) => {
  const div = document.createElement('div');
  const app = createApp(component, props);
  app.mount(div);
  return div;
};

onMounted(() => {
  map = new Map({
    accessToken: mapboxAccessToken,
    container: 'map',
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    center: location.value ?? leipzig,
    zoom: 10,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();

  map.addControl(
    {
      onAdd(map) {
        const div = mount(Toolbar, { map });
        div.className = 'mapboxgl-ctrl';
        return div;
      },
    },
    'top-left',
  );
  map.addControl(
    {
      onAdd() {
        const div = mount(Legend);
        div.className = 'mapboxgl-ctrl';
        return div;
      },
    },
    'bottom-left',
  );
  map.addControl(new ScaleControl());

  watchOnce(
    location,
    (latLng) => {
      map.setCenter(latLng);

      const marker = new Marker(mount(LocationMarker));
      marker.setLngLat(latLng);
      marker.addTo(map);

      watch(location, (latLng) => {
        marker.setLngLat(latLng);
      });
    },
    { immediate: location.value != null },
  );

  map.on('load', () => {
    const symbolLayer = map.getStyle().layers.find(({ type }) => type === 'symbol');
    for (const [id, layer] of Object.entries(layers)) {
      map.addSource(id, { type: 'geojson', data: layer.url });
      map.addLayer(
        {
          id: id,
          type: 'circle',
          source: id,
          paint: {
            'circle-color': layer.color,
            'circle-radius': {
              stops: [
                [6, 1],
                [18, 16],
              ],
            },
          },
        },
        symbolLayer?.id,
      );
    }

    const layerIds = Object.keys(layers);

    map.on('mouseenter', layerIds, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', layerIds, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', layerIds, (event) => {
      const feats = event.features[0];
      const layer = layers[feats.layer.id];
      const props = feats.properties;

      const popup = new Popup({
        maxWidth: document.body.getBoundingClientRect().width,
        closeButton: false,
      });
      popup.setLngLat(feats.geometry.coordinates);
      popup.setHTML(
        [
          props.name ?? layer.textSingular,
          props.id ? `ID: ${props.id}` : '',
          props.openingHours ? `Opening hours: ${props.openingHours}` : '',
          props.tested ? 'Place has been tested' : '',
        ]
          .filter(Boolean)
          .join('<br>'),
      );
      popup.addTo(map);
    });

    const updateLayerVisibilities = () => {
      for (const id of layerIds) {
        map.setLayoutProperty(id, 'visibility', settings.value[id] ? 'visible' : 'none');
      }
    };

    watch(settings, updateLayerVisibilities, { deep: true, immediate: true });
  });
});
</script>

<style lang="scss">
.mapboxgl-ctrl-scale {
  @apply bg-shade-5;
  @apply text-shade-2;
  @apply border-none;
  @apply rounded-sm;
}

.mapboxgl-popup-content {
  @apply px-2;
  @apply py-1.5;
  @apply bg-shade-5;
  @apply text-shade-2;
  @apply rounded-sm;
}

.mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip {
  @apply border-t-shade-5;
}
</style>
