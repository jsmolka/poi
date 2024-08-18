<template>
  <div id="map" class="h-full bg-shade-6" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import graveyards from '@/data/graveyards.json';
import stations from '@/data/stations.json';
import { colors } from '@/utils/colors';
import LocationMarker from '@/views/LocationMarker.vue';
import { useGeolocation, watchOnce } from '@vueuse/core';
import { Map, Marker, Popup, ScaleControl } from 'mapbox-gl';
import { computed, createApp, onMounted, watch } from 'vue';

const { coords, isSupported } = useGeolocation();

const location = computed(() => {
  if (!isSupported.value) {
    return null;
  }
  const { latitude, longitude } = coords.value;
  if (latitude == null || latitude == Infinity || longitude == null || longitude == Infinity) {
    return null;
  }
  return {
    lat: latitude,
    lng: longitude,
  };
});

const center = computed(() => {
  return (
    location.value ?? {
      lat: 51.34482272560187,
      lng: 12.381337332992878,
    }
  );
});

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
    center: center.value,
    zoom: 10,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
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
    const createSource = (locations) => ({
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: locations.map((location) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [location.lng, location.lat],
          },
          properties: {
            location,
          },
        })),
      },
    });

    map.addSource('stations', createSource(stations));
    map.addSource('graveyards', createSource(graveyards));

    const createLayer = (id, color) => ({
      id,
      type: 'circle',
      source: id,
      paint: {
        'circle-radius': {
          base: 1,
          stops: [
            [6, 1],
            [18, 16],
          ],
        },
        'circle-color': color,
      },
    });

    map.addLayer(createLayer('stations', colors.shade2.hex));
    map.addLayer(createLayer('graveyards', colors.red.hex));

    const layers = ['stations', 'graveyards'];

    map.on('mouseenter', layers, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', layers, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', layers, (event) => {
      const coordinates = event.features[0].geometry.coordinates;
      const location = JSON.parse(event.features[0].properties.location);
      new Popup({ closeButton: false, maxWidth: '256px' })
        .setLngLat(coordinates)
        .setHTML(location.name)
        .addTo(map);
    });
  });
});
</script>

<style lang="scss">
.mapboxgl-ctrl-scale {
  @apply bg-shade-5;
  @apply text-shade-2;
  @apply border-none;
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
