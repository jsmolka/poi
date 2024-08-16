<template>
  <div id="map" class="h-full"></div>
</template>

<script setup>
import { mapboxAccessToken } from '@/common/mapboxAccessToken';
import { Map } from 'mapbox-gl';
import { onMounted } from 'vue';

onMounted(() => {
  new Map({
    accessToken: mapboxAccessToken,
    container: 'map',
    style: 'mapbox://styles/juliansmolka/clzwx15zy002n01qs7yrr9zsr',
  });
});
</script>
