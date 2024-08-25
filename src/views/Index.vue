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

  watchOnce(location, (latLng) => {
    map.setCenter(latLng);

    const marker = new Marker(mount(LocationMarker));
    marker.setLngLat(latLng);
    marker.addTo(map);

    watch(location, (latLng) => {
      marker.setLngLat(latLng);
    });
  });

  map.on('load', () => {
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
        map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id,
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
      const props = event.features[0].properties;
      const layer = layers[event.features[0].layer.id];

      const popup = new Popup({ maxWidth: Infinity, closeButton: false });
      popup.setLngLat(event.features[0].geometry.coordinates);
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
      for (const layerId of layerIds) {
        map.setLayoutProperty(layerId, 'visibility', settings.value[layerId] ? 'visible' : 'none');
      }
    };

    watch(settings, updateLayerVisibilities, { deep: true });

    updateLayerVisibilities();
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

.mapboxgl-control-container {
  @apply z-10;
}

.mapboxgl-ctrl-bottom-left,
.mapboxgl-ctrl-bottom-right,
.mapboxgl-ctrl-top-left,
.mapboxgl-ctrl-top-right {
  @apply pointer-events-auto;
  @apply z-10;
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
