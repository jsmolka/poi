<template>
  <div id="map" class="h-full" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import { locations } from '@/data/locations';
import Marker from '@/views/Marker.vue';
import MarkerLocation from '@/views/MarkerLocation.vue';
import { useGeolocation, watchOnce } from '@vueuse/core';
import { Map, Marker as MapMarker } from 'mapbox-gl';
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

  watchOnce(location, (latLng) => {
    map.setCenter(latLng);

    const marker = new MapMarker(mount(MarkerLocation));
    marker.setLngLat(latLng);
    marker.addTo(map);

    watch(location, (latLng) => {
      marker.setLngLat(latLng);
    });
  });

  for (const location of locations) {
    const marker = new MapMarker(mount(Marker));
    marker.setLngLat(location);
    marker.addTo(map);
  }
});
</script>
