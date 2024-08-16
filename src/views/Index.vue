<template>
  <div id="map" class="h-full" />
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import { useGeolocation, watchOnce } from '@vueuse/core';
import { Map } from 'mapbox-gl';
import { onMounted } from 'vue';

const leipzig = {
  latitude: 51.3397,
  longitude: 12.3731,
};

const { coords, isSupported } = useGeolocation();

let map = null;

onMounted(() => {
  map = new Map({
    accessToken: mapboxAccessToken,
    container: 'map',
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
    center: [leipzig.longitude, leipzig.latitude],
    zoom: 10,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  watchOnce(coords, ({ longitude, latitude }) => {
    map.setCenter([longitude, latitude]);
  });
});
</script>
