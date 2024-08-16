<template>
  <div id="map" class="h-full" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import LocationMarker from '@/views/LocationMarker.vue';
import { useGeolocation, watchOnce } from '@vueuse/core';
import { Map, Marker } from 'mapbox-gl';
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
      lat: 51.3397,
      lng: 12.3731,
    }
  );
});

let map = null;

const createMarker = (component, props = {}) => {
  const div = document.createElement('div');
  const app = createApp(component, props);
  app.mount(div);
  return new Marker(div);
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

    const marker = createMarker(LocationMarker);
    marker.setLngLat(latLng);
    marker.addTo(map);

    watch(location, (latLng) => {
      marker.setLngLat(latLng);
    });
  });
});
</script>
