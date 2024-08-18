<template>
  <div id="map" class="h-full bg-shade-6" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
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
    map.addSource('stations', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: stations.map((station) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [station.lng, station.lat],
          },
          properties: {
            station,
          },
        })),
      },
    });

    map.addLayer({
      id: 'stations',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': {
          base: 1,
          stops: [
            [6, 1],
            [18, 16],
          ],
        },
        'circle-color': colors.shade2.hex,
      },
    });

    map.on('mouseenter', 'stations', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'stations', () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', 'stations', (event) => {
      const coordinates = event.features[0].geometry.coordinates;
      const station = JSON.parse(event.features[0].properties.station);
      new Popup({ closeButton: false, maxWidth: '256px' })
        .setLngLat(coordinates)
        .setHTML(station.brand)
        .addTo(map);
    });
  });
});
</script>

<style lang="scss">
.mapboxgl-popup-content {
  @apply px-2;
  @apply py-1.5;
  @apply bg-shade-6;
  @apply text-shade-2;
  @apply rounded-sm;
}

.mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip {
  @apply border-t-shade-6;
}
</style>
